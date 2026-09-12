#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { clientConfig, request } from "./client.mjs";
import { eventReporter, agentEnvironment } from "./reporting.mjs";
const args = process.argv.slice(2);
const command = args.shift();
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
};
const output = (value) =>
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
async function wrap() {
  const separator = args.indexOf("--");
  if (separator < 0 || !args[separator + 1])
    throw Error("wrap requires -- command [args...]");
  const agentId = option("agent") ?? process.env.AGENT_DESK_AGENT_ID;
  const ticketId = option("ticket") ?? process.env.AGENT_DESK_TICKET_ID;
  if (!agentId || !ticketId)
    throw Error("wrap requires an assigned --ticket and --agent.");
  const config = clientConfig(agentId);
  const sessionId = option("session") ?? `external-${randomUUID()}`;
  const run = await request(
    "POST",
    `/api/tickets/${encodeURIComponent(ticketId)}/claim`,
    { agentId, sessionId },
    config,
  );
  const emit = eventReporter({ run, agentId, sessionId, config });
  const child = spawn(args[separator + 1], args.slice(separator + 2), {
    stdio: "inherit",
    env: agentEnvironment(process.env, {
      AGENT_DESK_URL: config.url,
      AGENT_DESK_TOKEN: config.token,
      AGENT_DESK_WRAPPED: "1",
      AGENT_DESK_EXECUTION_ID: run.id,
      AGENT_DESK_SESSION_ID: sessionId,
      AGENT_DESK_AGENT_ID: agentId,
      AGENT_DESK_TICKET_ID: ticketId,
    }),
  });
  let reportingFailed = false;
  const timer = setInterval(
    () =>
      emit("heartbeat", "External agent runner is active.").catch(() => {
        reportingFailed = true;
        console.error("Agent Desk progress unavailable; claim retained.");
      }),
    15000,
  );
  timer.unref();
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  process.on("SIGINT", () => child.kill("SIGINT"));
  child.on("error", async () => {
    clearInterval(timer);
    await emit("failed", "External command failed to start.").catch(() => {});
    process.exitCode = 1;
  });
  child.on("exit", async (code, signal) => {
    clearInterval(timer);
    await emit(
      code === 0 ? "complete" : signal ? "stopped" : "failed",
      code === 0
        ? "External runner finished; review and delivery evidence still required."
        : signal
          ? "External runner stopped; work retained."
          : `External runner failed (exit ${code}).`,
    ).catch(() => {
      reportingFailed = true;
      console.error(
        "Final progress could not be delivered; claim retained for reconciliation.",
      );
    });
    process.exitCode = code ?? (signal ? 130 : 1);
    if (reportingFailed && process.exitCode === 0) process.exitCode = 1;
  });
}
try {
  if (command === "state" || command === "health")
    output(
      await request("GET", command === "health" ? "/api/health" : "/api/state"),
    );
  else if (command === "request") {
    const [method, path, raw] = args;
    output(await request(method, path, raw ? JSON.parse(raw) : undefined));
  } else if (command === "claim") {
    const [ticketId] = args;
    const agentId = option("agent") ?? process.env.AGENT_DESK_AGENT_ID;
    const sessionId = option("session") ?? process.env.AGENT_DESK_SESSION_ID;
    if (!agentId || !sessionId)
      throw Error("claim requires --agent and --session.");
    output(
      await request(
        "POST",
        `/api/tickets/${encodeURIComponent(ticketId)}/claim`,
        { agentId, sessionId },
        clientConfig(agentId),
      ),
    );
  } else if (command === "event") {
    const [executionId] = args;
    const agentId = option("agent") ?? process.env.AGENT_DESK_AGENT_ID;
    const sessionId = option("session") ?? process.env.AGENT_DESK_SESSION_ID;
    output(
      await request(
        "POST",
        `/api/executions/${encodeURIComponent(executionId)}/events`,
        {
          agentId,
          sessionId,
          eventId: option("event-id") ?? randomUUID(),
          seq: Number(option("seq")),
          type: option("type") ?? "progress",
          summary: option("summary") ?? "",
          ...(option("progress")
            ? { progress: Number(option("progress")) }
            : {}),
        },
        clientConfig(agentId),
      ),
    );
  } else if (command === "wrap") await wrap();
  else if (command === "mcp") {
    await import("./mcp.mjs");
  } else if (command === "migration-preview") {
    const { previewKangentic } = await import("../server/migrate.mjs");
    output(await previewKangentic(args[0]));
  } else {
    console.log(
      "Agent Desk\n  health | state\n  request METHOD /api/path [JSON]\n  claim TICKET --agent AGENT --session SESSION\n  event EXECUTION --agent AGENT --session SESSION --seq N --type progress --summary TEXT\n  wrap --ticket TICKET --agent AGENT [--session SESSION] -- COMMAND [ARGS...]\n  mcp --agent AGENT\n  migration-preview SOURCE_DIRECTORY",
    );
    if (command) process.exitCode = 1;
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
