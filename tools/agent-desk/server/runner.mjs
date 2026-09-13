import { createManagedBridge } from "./managed-bridge.mjs";
import { captureProcessIdentity } from "./session-trace.mjs";
import { RunCoordinator } from "./run-coordinator.mjs";
import { fileURLToPath } from "node:url";
import { buildTaskPacket } from "./task-packet.mjs";
import { spawn, execFileSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  realpathSync,
} from "node:fs";
import { delimiter, join, isAbsolute } from "node:path";
import { id, fail } from "./store.mjs";
import { agentEnvironment } from "../bin/reporting.mjs";
const adapters = {
  codex: { command: "codex", args: ["exec", "--json"] },
  claude: {
    command: "claude",
    args: ["--print", "--verbose", "--output-format", "stream-json"],
  },
  gemini: { command: "gemini", args: ["--output-format", "stream-json", "-p"] },
  cursor: {
    command: "agent",
    args: ["--print", "--output-format", "stream-json"],
  },
};
export function executable(name) {
  for (const folder of (process.env.PATH ?? "").split(delimiter)) {
    if (!folder) continue;
    const path = join(folder, name);
    try {
      accessSync(path, constants.X_OK);
      return path;
    } catch {}
  }
  return null;
}
export class Runner {
  constructor(service, { dataDir, url }) {
    this.service = service;
    this.dataDir = dataDir;
    this.url = url;
    this.children = new Map();
    for (const ticket of service.store.list("ticket")) {
      const execution = service.store.active(ticket.id);
      if (execution?.managedBy === "agent-desk" && !execution.external) {
        service.store.saveExecution({
          ...execution,
          external: true,
          state: "interrupted",
          summary:
            "Supervisor restarted; prior process state is unverified. Reconcile the retained session before restarting.",
        });
      }
    }
    this.coordinator = new RunCoordinator(service, this);
    service.on("autostart", (ticketId) =>
      setImmediate(() => {
        try {
          this.start(ticketId, { automatic: true });
        } catch (e) {
          service.store.activity(ticketId, "start_refused", e.message);
          service.changed();
        }
      }),
    );
  }
  availability() {
    return this.service.store.list("agent").map((a) => ({
      id: a.id,
      available:
        !!adapters[a.adapter] && !!executable(adapters[a.adapter].command),
      reason: adapters[a.adapter]
        ? executable(adapters[a.adapter].command)
          ? undefined
          : "CLI not installed or not on service PATH"
        : "Reports through CLI/MCP; no direct launch adapter",
    }));
  }
  start(ticketId, { automatic = false } = {}) {
    const ticket = this.service.require("ticket", ticketId);
    if (
      [...this.children.keys()].some(
        (key) => this.service.store.execution(key)?.ticketId === ticketId,
      )
    )
      fail(
        409,
        "ALREADY_RUNNING",
        "This ticket still has a managed background process; wait for it to stop.",
      );
    const agent = this.service.require("agent", ticket.ownerId);
    const adapter = adapters[agent.adapter];
    if (!adapter)
      fail(
        422,
        "EXTERNAL_AGENT",
        "This agent reports through the CLI/MCP connector; start it in its own client.",
      );
    const command = executable(adapter.command);
    if (!command)
      fail(
        422,
        "ADAPTER_UNAVAILABLE",
        "The assigned agent CLI is unavailable.",
      );
    const project = this.service.require("project", ticket.projectId);
    if (!project.path || !isAbsolute(project.path) || !existsSync(project.path))
      fail(
        422,
        "PROJECT_PATH",
        "Configure an existing absolute project path before starting.",
      );
    const root = realpathSync(project.path);
    let base;
    try {
      base = execFileSync(
        "git",
        ["-C", root, "rev-parse", "--verify", "origin/main"],
        { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] },
      ).trim();
    } catch {
      fail(
        422,
        "GIT_BASE",
        "Project needs a fetched origin/main before isolated execution.",
      );
    }
    const prior = this.service.store.latest(ticketId);
    const resolveBlockers =
      !automatic &&
      (this.service.resolutionNeeded(ticket) || prior?.state === "revoked");
    const run = this.service.claim(
      ticketId,
      {
        agentId: agent.id,
        sessionId: `desk-${id()}`,
      },
      { resolveBlockers },
    );
    let child, heartbeat, bridge;
    const send = (type, summary, extra = {}) => {
      const current = this.service.store.execution(run.id);
      if (current?.releasedAt) return;
      return this.service.event(run.id, {
        agentId: agent.id,
        sessionId: run.sessionId,
        eventId: id(),
        seq: current.lastSeq + 1,
        type,
        summary,
        ...extra,
      });
    };
    try {
      const worktree = join(this.dataDir, "worktrees", run.id);
      mkdirSync(join(this.dataDir, "worktrees"), {
        recursive: true,
        mode: 0o700,
      });
      const branch = `codex/desk-${ticket.number}-${run.id.slice(0, 8)}`;
      execFileSync(
        "git",
        ["-C", root, "worktree", "add", "-b", branch, worktree, base],
        { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] },
      );
      this.service.store.saveExecution({
        ...run,
        branch,
        worktreePath: worktree,
        baseSha: base,
      });
      const currentTicket = this.service.require("ticket", ticketId);
      const activeStage = this.service.store
        .list("stage", ticket.projectId)
        .find((s) => s.role === "active");
      if (currentTicket.stageId !== activeStage.id)
        this.service.updateTicket(ticketId, {
          version: currentTicket.version,
          stageId: activeStage.id,
        });
      bridge = createManagedBridge({
        service: this.service,
        execution: run,
        worktree,
        sendEvent: send,
      });
      const prompt = buildTaskPacket({
        ticket: this.service.getTicket(ticket.id),
        project,
        execution: run,
        worktree,
        managedClient: {
          node: process.execPath,
          path: fileURLToPath(
            new URL("../bin/managed-client.mjs", import.meta.url),
          ),
          directory: bridge.directory,
        },
        recoveryContext:
          prior?.state === "revoked"
            ? {
                executionId: prior.id,
                sessionId: prior.sessionId,
                worktreePath: prior.worktreePath,
                branch: prior.branch,
                summary: prior.summary,
              }
            : null,
        resolutionContext: resolveBlockers
          ? this.service.resolutionContext(ticketId, {
              agentId: agent.id,
              executionId: run.id,
              sessionId: run.sessionId,
            })
          : null,
      });
      child = spawn(command, [...adapter.args, prompt], {
        cwd: worktree,
        env: agentEnvironment(process.env, {
          AGENT_DESK_WRAPPED: "1",
          AGENT_DESK_URL: this.url,
          AGENT_DESK_BRIDGE_DIR: bridge.directory,
          AGENT_DESK_TICKET_ID: ticket.id,
          AGENT_DESK_EXECUTION_ID: run.id,
          AGENT_DESK_SESSION_ID: run.sessionId,
          AGENT_DESK_AGENT_ID: agent.id,
        }),
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
      this.service.store.saveExecution({
        ...this.service.store.execution(run.id),
        managedBy: "agent-desk",
        pid: child.pid ?? null,
      });
      this.children.set(run.id, child);
      captureProcessIdentity(child.pid)
        .then((processIdentity) => {
          const current = this.service.store.execution(run.id);
          if (processIdentity && current && !current.releasedAt)
            this.service.store.saveExecution({ ...current, processIdentity });
        })
        .catch(() => {});
      let buffered = "";
      child.stdout.on("data", (chunk) => {
        buffered += chunk.toString();
        if (buffered.length > 262144) buffered = buffered.slice(-65536);
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            const kind = String(event.type ?? "");
            if (
              agent.adapter === "codex" &&
              kind === "thread.started" &&
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                event.thread_id ?? "",
              )
            ) {
              const current = this.service.store.execution(run.id);
              this.service.store.saveExecution({
                ...current,
                nativeSessionId: event.thread_id,
                nativeSessionSource: "runner",
              });
            }
            if (["turn.started", "thread.started"].includes(kind))
              send("progress", `Agent ${kind.replaceAll(".", " ")}`);
            if (
              kind === "item.completed" &&
              event.item?.type === "agent_message"
            )
              send(
                "progress",
                String(event.item.text ?? "Agent update").slice(0, 1500),
              );
            if (kind === "result" && event.is_error)
              send(
                "progress",
                "Agent reported an error; awaiting process exit.",
              );
          } catch {}
        }
      });
      // Drain stderr without persisting potentially credential-bearing diagnostics.
      child.stderr.on("data", () => {});
      heartbeat = setInterval(
        () =>
          send(
            "heartbeat",
            this.service.store.execution(run.id)?.summary ?? "Agent running",
          ),
        15000,
      );
      heartbeat.unref();
      child.once("error", () => {
        bridge.close();
        clearInterval(heartbeat);
        this.children.delete(run.id);
        send(
          "failed",
          "Agent could not be started. Check local CLI installation and authentication.",
        );
      });
      child.once("close", async (code, signal) => {
        clearInterval(heartbeat);
        try {
          await bridge.flush();
          this.children.delete(run.id);
          const current = this.service.store.execution(run.id);
          if (current && !current.releasedAt) {
            const last = current.summary || "No agent progress was reported.";
            send(
              code === 0 ? "checkpoint" : signal ? "stopped" : "failed",
              `${code === 0 ? "Agent exited without a terminal task report; checkpoint retained." : signal ? "Agent process stopped; worktree retained." : `Agent exited with code ${code}; worktree retained.`} ${last}`.slice(
                0,
                4000,
              ),
            );
          }
        } finally {
          bridge.close();
          this.children.delete(run.id);
          this.service.changed();
        }
      });
      return this.service.store.execution(run.id);
    } catch (e) {
      bridge?.close();
      send(
        "failed",
        "Dispatch failed; any created worktree is retained for inspection.",
      );
      throw e.status
        ? e
        : new Error(
            "Unable to prepare an isolated worktree or start the agent.",
          );
    }
  }
  stop(ticketId) {
    const run = this.service.store.active(ticketId);
    if (!run) fail(409, "NO_ACTIVE_EXECUTION", "No active execution to stop.");
    const child = this.children.get(run.id);
    if (!child)
      fail(
        409,
        "EXTERNAL_EXECUTION",
        "This session is owned by another client. Stop and checkpoint it there.",
      );
    try {
      if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    return run;
  }
}
