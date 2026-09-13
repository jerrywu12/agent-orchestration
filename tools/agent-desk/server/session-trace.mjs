import { execFile } from "node:child_process";
import { opendir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const validPid = (pid) =>
  Number.isSafeInteger(pid) && pid > 0 && pid <= 2147483647;
const nativeId = (value) =>
  typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
const nativeEnvironment = { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C" };

function validIdentity(identity, pid) {
  return (
    identity?.pid === pid &&
    ["darwin", "linux"].includes(identity.platform) &&
    typeof identity.command === "string" &&
    identity.command.length > 0 &&
    identity.command.length <= 1024 &&
    typeof identity.startedAt === "string" &&
    identity.startedAt.length > 0 &&
    identity.startedAt.length <= 160
  );
}

async function bounded(task, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      task(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("Observation deadline")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function readSmall(path, bytes) {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(bytes + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > bytes) throw Error("Metadata exceeds limit");
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    await file.close();
  }
}

// Never read process argv: agent prompts and credentials can appear there.
async function processProbe(pid) {
  if (!validPid(pid)) return { alive: null, identity: null };
  if (process.platform === "linux") {
    let stat;
    try {
      stat = await readSmall(`/proc/${pid}/stat`, 4096);
    } catch (error) {
      if (error.code === "ENOENT") {
        // Missing /proc itself is source failure, not proof of a stopped PID.
        try {
          await readSmall("/proc/self/stat", 4096);
          return { alive: false, identity: null };
        } catch {}
      }
      return { alive: null, identity: null };
    }
    try {
      const boot = await readSmall("/proc/sys/kernel/random/boot_id", 128);
      const end = stat.lastIndexOf(")");
      const start = stat.indexOf("(");
      const fields = stat
        .slice(end + 2)
        .trim()
        .split(/\s+/);
      if (
        start < 0 ||
        end <= start ||
        !/^\d+$/.test(fields[19] ?? "") ||
        !UUID.test(boot.trim())
      )
        return { alive: null, identity: null };
      return {
        alive: true,
        identity: {
          pid,
          platform: "linux",
          command: stat.slice(start + 1, end),
          startedAt: `${boot.trim()}:${fields[19]}`,
        },
      };
    } catch {
      return { alive: null, identity: null };
    }
  }
  if (process.platform !== "darwin") return { alive: null, identity: null };
  try {
    const { stdout } = await execute(
      "/bin/ps",
      ["-p", String(pid), "-o", "pid=", "-o", "lstart=", "-o", "comm="],
      {
        encoding: "utf8",
        timeout: 900,
        maxBuffer: 4096,
        env: nativeEnvironment,
      },
    );
    const match = stdout.trim().match(/^(\d+)\s+(.{24})\s+(.+)$/);
    if (!match || Number(match[1]) !== pid)
      return { alive: null, identity: null };
    return {
      alive: true,
      identity: {
        pid,
        platform: "darwin",
        command: match[3].trim(),
        startedAt: match[2],
      },
    };
  } catch (error) {
    return {
      alive:
        error.code === 1 && !error.stdout?.trim() && !error.stderr?.trim()
          ? false
          : null,
      identity: null,
    };
  }
}

async function observeProcess(pid, probe) {
  try {
    return await bounded(() => probe(pid), 1200);
  } catch {
    return { alive: null, identity: null };
  }
}

/** Capture at spawn, then persist beside the PID. A PID alone cannot be traced. */
export async function captureProcessIdentity(
  pid,
  { probe = processProbe } = {},
) {
  if (!validPid(pid)) return null;
  const observation = await observeProcess(pid, probe);
  if (observation?.alive !== true || !validIdentity(observation.identity, pid))
    return null;
  const { platform, command, startedAt } = observation.identity;
  return { pid, platform, command, startedAt };
}

// Run SQLite in a bounded child so a busy/corrupt/large registry cannot block
// the HTTP event loop. Select only exact task IDs; never read transcript bodies,
// titles, previews, token counts, configuration or session file contents.
const registryQuery = `
import { DatabaseSync } from 'node:sqlite';
const [path, idsJson, cwd] = process.argv.slice(1);
const ids = JSON.parse(idsJson);
const db = new DatabaseSync(path, { readOnly: true, timeout: 250 });
try {
  let rows = [];
  let matchedBy = 'id';
  if (ids.length) rows = db.prepare(
    'SELECT id FROM threads WHERE id IN (' + ids.map(() => '?').join(',') + ') LIMIT 2'
  ).all(...ids);
  if (!rows.length && cwd) {
    matchedBy = 'worktree';
    rows = db.prepare('SELECT id FROM threads WHERE cwd = ? LIMIT 2').all(cwd);
  }
  process.stdout.write(JSON.stringify({ ids: rows.map(row => row.id), matchedBy }));
} finally { db.close(); }
`;

async function registryPath(codexHome) {
  const directory = await opendir(codexHome);
  let latest = null;
  let count = 0;
  try {
    for await (const entry of directory) {
      // Do not traverse sessions or inventory the home directory recursively.
      if (++count > 256) throw Error("Registry directory limit");
      const match = entry.name.match(/^state_(\d{1,3})\.sqlite$/);
      if (
        match &&
        entry.isFile() &&
        (!latest || Number(match[1]) > latest.version)
      )
        latest = {
          version: Number(match[1]),
          path: join(codexHome, entry.name),
        };
    }
  } finally {
    await directory.close().catch(() => {});
  }
  return latest?.path ?? null;
}

async function traceNative(execution, codexHome) {
  const captured = nativeId(execution.nativeSessionId);
  if (
    captured &&
    execution.managedBy === "agent-desk" &&
    execution.nativeSessionSource === "runner"
  )
    return {
      id: captured,
      evidence:
        "Native Codex task ID captured from the runner's thread.started event.",
    };

  const ids = [
    ...new Set([captured, nativeId(execution.sessionId)].filter(Boolean)),
  ];
  const worktree =
    execution.managedBy === "agent-desk" &&
    typeof execution.worktreePath === "string" &&
    execution.worktreePath.length <= 4096 &&
    isAbsolute(execution.worktreePath) &&
    basename(execution.worktreePath) === execution.id
      ? execution.worktreePath
      : "";
  if (!ids.length && !worktree)
    return {
      id: null,
      evidence:
        "No confirmed Codex task ID or unique managed worktree is recorded.",
    };
  try {
    const path = await bounded(() => registryPath(codexHome), 600);
    if (!path)
      return {
        id: null,
        evidence:
          "Codex task registry is missing; native task identity remains unknown.",
      };
    const { stdout } = await execute(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        registryQuery,
        path,
        JSON.stringify(ids),
        worktree,
      ],
      {
        encoding: "utf8",
        timeout: 1500,
        maxBuffer: 4096,
        env: nativeEnvironment,
      },
    );
    const result = JSON.parse(stdout);
    if (!Array.isArray(result.ids)) throw Error("Invalid registry metadata");
    if (result.ids.length > 1)
      return {
        id: null,
        evidence:
          "Multiple native task records match; the native task identity is ambiguous.",
      };
    const found = nativeId(result.ids[0]);
    if (!found)
      return {
        id: null,
        evidence:
          "No exact native task record was found; absence does not prove execution stopped.",
      };
    return {
      id: found,
      evidence:
        result.matchedBy === "worktree"
          ? "One native Codex task record matches the exact managed worktree."
          : "Native Codex task ID matches an exact local registry record.",
    };
  } catch {
    return {
      id: null,
      evidence:
        "Codex task registry is unavailable; native task identity remains unknown.",
    };
  }
}

/** Read-only observation. Never releases ownership, resumes tasks or signals processes. */
export async function traceExecution(
  execution,
  {
    children = new Map(),
    probe = processProbe,
    codexHome = process.env.CODEX_HOME || join(homedir(), ".codex"),
  } = {},
) {
  execution ??= {};
  const evidence = [];
  let tracking = "untraceable";
  let processAlive = null;
  const child = children.get(execution.id);
  if (
    child &&
    validPid(child.pid) &&
    child.exitCode === null &&
    child.signalCode === null
  ) {
    tracking = "managed";
    processAlive = true;
    evidence.push(
      "This supervisor owns the exact live child process for this execution.",
    );
  } else if (child && (child.exitCode != null || child.signalCode != null)) {
    processAlive = false;
    evidence.push("This supervisor observed the exact execution child exit.");
  } else if (
    validPid(execution.pid) &&
    validIdentity(execution.processIdentity, execution.pid)
  ) {
    const observation = await observeProcess(execution.pid, probe);
    if (observation?.alive === false) {
      processAlive = false;
      evidence.push(
        "The recorded process PID is absent from the native process table.",
      );
    } else if (
      observation?.alive === true &&
      validIdentity(observation.identity, execution.pid)
    ) {
      const expected = execution.processIdentity;
      const actual = observation.identity;
      // exec can replace a launcher image without changing the process birth.
      // A command change must never make that live execution eligible for takeover.
      if (
        ["pid", "platform", "startedAt"].every(
          (key) => expected[key] === actual[key],
        )
      ) {
        tracking = "process";
        processAlive = true;
        evidence.push(
          "The live process matches the captured PID, platform and start fingerprint.",
        );
        if (expected.command !== actual.command)
          evidence.push(
            "The command changed while the process birth identity remained the same; execution is still live.",
          );
      } else {
        processAlive = false;
        evidence.push(
          "The recorded PID now has a different process identity; PID reuse cannot confirm this execution.",
        );
      }
    } else {
      evidence.push(
        "Native process observation is unavailable or incomplete; process state remains unknown.",
      );
    }
  } else {
    evidence.push(
      "No supervisor-owned child or complete captured process fingerprint is available.",
    );
  }
  const native = await traceNative(execution, codexHome);
  evidence.push(native.evidence);
  if (tracking === "untraceable" && native.id) tracking = "recorded";
  const reason =
    tracking === "managed"
      ? "Agent Desk is supervising this background process; a visible desktop chat is not required."
      : tracking === "process"
        ? "The recorded background process is verified, but this supervisor does not own it."
        : tracking === "recorded"
          ? "A native Codex task is recorded; its current execution and desktop visibility are unverified."
          : processAlive === false
            ? "The captured process is no longer present under its recorded identity. Retained ownership needs explicit reconciliation."
            : "No live execution or native task could be confirmed. Retained ownership needs explicit reconciliation.";
  return {
    tracking,
    processAlive,
    nativeSessionId: native.id,
    nativeThreadUrl: native.id ? `codex://threads/${native.id}` : null,
    evidence: evidence.slice(0, 6).map((value) => value.slice(0, 240)),
    reason,
  };
}
