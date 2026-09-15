import { DatabaseSync } from "node:sqlite";
import { execFile } from "node:child_process";
import {
  existsSync,
  lstatSync,
  realpathSync,
  readdirSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { homedir, platform as hostPlatform } from "node:os";

export const ACTIVITY_LIMITS = Object.freeze({
  taskRecencySeconds: 86400,
  tailInitialBytes: 256 * 1024,
  tailEscalatedBytes: 4 * 1024 * 1024,
  busyTimeoutMs: 50,
  psMaxBuffer: 2 * 1024 * 1024,
  psMaxRows: 10000,
  maxTasks: 200,
  maxWorkers: 200,
  maxHolders: 50,
  maxNotes: 20,
  maxNoteLength: 320,
  collectorTimeoutMs: 8000,
  refreshIntervalMs: 15000,
});

export const REASONS = Object.freeze({
  SOURCE_NOT_FOUND: "The Codex task source was not found on this machine.",
  UNRECOGNIZED_FORMAT:
    "The Codex task source uses an unrecognized format and was not read.",
  READ_FAILED: "The Codex task source could not be read; it may be in use.",
  PLATFORM_UNSUPPORTED: "Process observation is unsupported on this platform.",
  PROCESS_UNOBSERVABLE: "Process metadata could not be observed.",
  CONTAINER_UNOBSERVABLE:
    "Host activity cannot be observed from inside a container.",
});

export const TRACKED_AGENTS = Object.freeze([
  { id: "claude", name: "Claude Code", bin: "claude" },
  { id: "gemini", name: "Gemini CLI", bin: "gemini" },
  { id: "agy", name: "Antigravity CLI", bin: "agy" },
  { id: "cursor", name: "Cursor Agent", bin: "cursor-agent" },
  { id: "hermes", name: "Hermes", bin: "hermes" },
  { id: "ollama", name: "Ollama", bin: "ollama" },
  { id: "arkcli", name: "ArkCLI", bin: "arkcli" },
  { id: "codex", name: "Codex", bin: "codex" },
]);

const REQUIRED_COLUMNS = [
  "id",
  "rollout_path",
  "updated_at",
  "archived",
  "source",
  "cwd",
  "title",
];

export function parseElapsedSeconds(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(?:(?:(\d+)-)?(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const [, daysStr, hoursStr, minsStr, secsStr] = match;
  const days = daysStr !== undefined ? Number(daysStr) : 0;
  const hours = hoursStr !== undefined ? Number(hoursStr) : 0;
  const mins = Number(minsStr);
  const secs = Number(secsStr);
  if (mins >= 60 || secs >= 60) return null;
  if (!Number.isSafeInteger(days) || !Number.isSafeInteger(hours)) return null;
  const total = days * 86400 + hours * 3600 + mins * 60 + secs;
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

export function normalizeDescription(raw) {
  if (typeof raw !== "string") return "Untitled task";
  const cleaned = raw
    .replace(/[|\r\n\t\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Untitled task";
  return cleaned.slice(0, 60);
}

export function workspaceSegment(raw) {
  if (typeof raw !== "string") return "—";
  const trimmed = raw.trim().replace(/[/\\]+$/, "");
  if (!trimmed) return "—";
  const segments = trimmed.split(/[/\\]/).filter(Boolean);
  const last = segments.pop();
  if (!last) return "—";
  const cleaned = last.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 60);
  return cleaned || "—";
}

/**
 * Classify Codex thread origin by shape only into the closed set:
 * "Codex" | "Codex app" | "Automation/CLI" | "Subagent"
 * Raw source values, subagent names, and paths are NEVER exposed (FR-005, R-004, FR-019).
 */
export function classifyOrigin(raw) {
  if (typeof raw !== "string" || !raw.trim()) return "Codex";
  const trimmed = raw.trim();
  if (trimmed === "vscode") return "Codex app";
  if (trimmed === "exec") return "Automation/CLI";
  if (trimmed === "cli") return "Codex";
  if (
    trimmed.includes("subagent") ||
    trimmed.includes("parent_thread_id") ||
    trimmed.includes("agent_path")
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        if (
          parsed.subagent ||
          parsed.parent_thread_id ||
          parsed.agent_path ||
          parsed.agent_nickname
        ) {
          return "Subagent";
        }
      }
    } catch {}
  }
  return "Codex";
}

export function defaultRunPs({ signal } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      "/bin/ps",
      ["-axo", "pid=,ppid=,etime=,command="],
      {
        encoding: "utf8",
        timeout: 2500,
        maxBuffer: ACTIVITY_LIMITS.psMaxBuffer,
        signal,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

export function matchAgentWorker(command) {
  if (typeof command !== "string") return null;

  // Exclusion 1: Desktop application bundle
  if (
    /\.app\/Contents\//i.test(command) ||
    /^\/Applications\/[^\/]+\.app\//i.test(command)
  ) {
    return null;
  }
  // Exclusion 2: IDE extensions directory
  if (
    /[/\\]\.?(?:vscode|cursor|windsurf)[/\\]extensions[/\\]/i.test(command) ||
    /[/\\]extensions[/\\]/i.test(command)
  ) {
    return null;
  }
  // Exclusion 3: IDE language-server helper lacking agent's own flag
  if (/language[-_]?server|languageserver|\blsp\b/i.test(command)) {
    return null;
  }
  // Exclusion 4: Observer's own process / tooling
  if (
    /\bagent-desk\b|\bagent-activity\b|\bcodex-status\.5s\.sh\b/i.test(command)
  ) {
    return null;
  }

  // Match against tracked agents
  for (const agent of TRACKED_AGENTS) {
    const pattern = new RegExp(
      `(?:^|[\\/\\\\])${agent.bin}(?:\\.js)?(?:\\s|$)`,
    );
    if (pattern.test(command)) {
      return agent;
    }
  }
  return null;
}

export function parseProcessList(
  psOutput,
  { codexTasksObservable = true } = {},
) {
  if (typeof psOutput !== "string")
    return { workers: [], codexFallbackWorkers: [] };
  const lines = psOutput.split(/\r?\n/);
  const workers = [];
  const codexFallbackWorkers = [];

  for (const line of lines.slice(0, ACTIVITY_LIMITS.psMaxRows)) {
    if (!line.trim()) continue;
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+([0-9:-]+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const etimeStr = match[3];
    const rawCommand = match[4];

    if (!Number.isSafeInteger(pid) || pid <= 0) continue;
    const elapsedSeconds = parseElapsedSeconds(etimeStr);
    if (elapsedSeconds === null) continue;

    const matched = matchAgentWorker(rawCommand);
    if (!matched) continue;

    // Command string discarded here — never reaches the snapshot (FR-019)
    if (matched.id === "codex") {
      codexFallbackWorkers.push({
        agentId: matched.id,
        agentName: matched.name,
        pid,
        elapsedSeconds,
      });
      if (!codexTasksObservable) {
        workers.push({
          agentId: matched.id,
          agentName: matched.name,
          pid,
          elapsedSeconds,
        });
      }
    } else {
      workers.push({
        agentId: matched.id,
        agentName: matched.name,
        pid,
        elapsedSeconds,
      });
    }
  }

  return { workers, codexFallbackWorkers };
}

function scanRolloutMarker(filePath, windowBytes) {
  let fd;
  try {
    const st = statSync(filePath);
    if (!st.isFile() || st.size === 0)
      return { marker: null, fileSize: st.size ?? 0 };
    const readLen = Math.min(windowBytes, st.size);
    const offset = Math.max(0, st.size - readLen);
    fd = openSync(filePath, "r");
    const buf = Buffer.alloc(readLen);
    readSync(fd, buf, 0, readLen, offset);
    const text = buf.toString("utf8");
    const matches = [...text.matchAll(/"type":"task_(started|complete)"/g)];
    if (!matches.length) return { marker: null, fileSize: st.size };
    return { marker: matches.at(-1)[1], fileSize: st.size };
  } catch {
    return { marker: null, fileSize: 0, error: true };
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {}
    }
  }
}

export function readCodexTasks({
  codexDir = join(homedir(), ".codex"),
  clock = Date.now,
} = {}) {
  let parent;
  try {
    const resolvedDir = resolve(codexDir);
    if (!existsSync(resolvedDir)) {
      return {
        status: "unobservable",
        reason: REASONS.SOURCE_NOT_FOUND,
        tasks: [],
      };
    }
    parent = realpathSync(resolvedDir);
    if (
      realpathSync(parent) !== parent ||
      !lstatSync(parent).isDirectory() ||
      lstatSync(resolvedDir).isSymbolicLink()
    ) {
      return {
        status: "unobservable",
        reason: REASONS.SOURCE_NOT_FOUND,
        tasks: [],
      };
    }
  } catch {
    return {
      status: "unobservable",
      reason: REASONS.SOURCE_NOT_FOUND,
      tasks: [],
    };
  }

  let highestN = -1;
  let highestFile = null;
  try {
    const entries = readdirSync(parent);
    for (const entry of entries) {
      const match = entry.match(/^state_(\d+)\.sqlite$/);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > highestN) {
          highestN = n;
          highestFile = entry;
        }
      }
    }
  } catch {
    return {
      status: "unobservable",
      reason: REASONS.READ_FAILED,
      tasks: [],
    };
  }

  if (!highestFile) {
    return {
      status: "unobservable",
      reason: REASONS.SOURCE_NOT_FOUND,
      tasks: [],
    };
  }

  const dbPath = join(parent, highestFile);
  try {
    if (
      realpathSync(dbPath) !== dbPath ||
      !lstatSync(dbPath).isFile() ||
      lstatSync(dbPath).isSymbolicLink()
    ) {
      return {
        status: "unobservable",
        reason: REASONS.READ_FAILED,
        tasks: [],
      };
    }
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = dbPath + suffix;
      if (
        existsSync(sidecar) &&
        (!lstatSync(sidecar).isFile() || lstatSync(sidecar).isSymbolicLink())
      ) {
        return {
          status: "unobservable",
          reason: REASONS.READ_FAILED,
          tasks: [],
        };
      }
    }
  } catch {
    return {
      status: "unobservable",
      reason: REASONS.READ_FAILED,
      tasks: [],
    };
  }

  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec(
      `PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=${ACTIVITY_LIMITS.busyTimeoutMs};`,
    );
    const table = db
      .prepare("SELECT type,sql FROM sqlite_schema WHERE name='threads'")
      .get();
    if (table?.type !== "table") {
      return {
        status: "unobservable",
        reason: REASONS.UNRECOGNIZED_FORMAT,
        tasks: [],
      };
    }
    const fields = db.prepare("PRAGMA table_xinfo(threads)").all();
    const columnNames = new Set(
      fields.filter((f) => f.hidden === 0).map((f) => f.name),
    );
    const hasAll = REQUIRED_COLUMNS.every((col) => columnNames.has(col));
    if (!hasAll) {
      return {
        status: "unobservable",
        reason: REASONS.UNRECOGNIZED_FORMAT,
        tasks: [],
      };
    }

    const nowSec = Math.floor(clock() / 1000);
    const cutoff = nowSec - ACTIVITY_LIMITS.taskRecencySeconds;
    const rows = db
      .prepare(
        "SELECT id, rollout_path, updated_at, archived, source, cwd, title FROM threads WHERE archived = 0 AND updated_at >= ? ORDER BY updated_at DESC",
      )
      .all(cutoff);

    const tasks = [];
    for (const row of rows) {
      if (!row.rollout_path || typeof row.rollout_path !== "string") continue;

      // Step 1: 256 KiB tail
      let scanResult = scanRolloutMarker(
        row.rollout_path,
        ACTIVITY_LIMITS.tailInitialBytes,
      );
      if (scanResult.error) continue;

      let lifecycle = null;
      if (scanResult.marker === "started") {
        lifecycle = "active";
      } else if (scanResult.marker === "complete") {
        continue;
      } else {
        // No marker found in 256 KiB
        if (scanResult.fileSize <= ACTIVITY_LIMITS.tailInitialBytes) {
          continue; // whole file scanned, never emitted
        }
        // Step 2: Escalate to 4 MiB
        scanResult = scanRolloutMarker(
          row.rollout_path,
          ACTIVITY_LIMITS.tailEscalatedBytes,
        );
        if (scanResult.error) continue;
        if (scanResult.marker === "started") {
          lifecycle = "active";
        } else if (scanResult.marker === "complete") {
          continue;
        } else {
          if (scanResult.fileSize <= ACTIVITY_LIMITS.tailEscalatedBytes) {
            continue; // whole file scanned, never emitted
          }
          lifecycle = "indeterminate";
        }
      }

      tasks.push({
        id: String(row.id).slice(0, 8),
        agentId: "codex",
        origin: classifyOrigin(row.source),
        description: normalizeDescription(row.title),
        workspace: workspaceSegment(row.cwd),
        lifecycle,
      });
    }

    return { status: "observed", reason: null, tasks };
  } catch {
    return {
      status: "unobservable",
      reason: REASONS.READ_FAILED,
      tasks: [],
    };
  } finally {
    if (db) {
      try {
        db.close();
      } catch {}
    }
  }
}

export async function collectActivity(options = {}) {
  const {
    codexDir = join(homedir(), ".codex"),
    runPs = defaultRunPs,
    platform = hostPlatform(),
    clock = Date.now,
  } = options;

  const codexRes = readCodexTasks({ codexDir, clock });
  const codexTasksObservable = codexRes.status === "observed";

  let psStatus = "observed";
  let psReason = null;
  let workers = [];
  let codexFallbackWorkers = [];

  if (!["darwin", "linux"].includes(platform)) {
    psStatus = "unobservable";
    psReason = REASONS.PLATFORM_UNSUPPORTED;
  } else {
    try {
      const output = typeof runPs === "function" ? await runPs() : "";
      if (typeof output !== "string") {
        psStatus = "unobservable";
        psReason = REASONS.PROCESS_UNOBSERVABLE;
      } else {
        const parsed = parseProcessList(output, { codexTasksObservable });
        workers = parsed.workers;
        codexFallbackWorkers = parsed.codexFallbackWorkers;
      }
    } catch {
      psStatus = "unobservable";
      psReason = REASONS.PROCESS_UNOBSERVABLE;
    }
  }

  const tasks = codexRes.tasks || [];
  const notes = [];
  if (!codexTasksObservable && codexFallbackWorkers.length > 0) {
    notes.push(
      "Codex task activity is unavailable; the count reflects processes only.",
    );
  }

  const partial =
    codexRes.status === "unobservable" ||
    psStatus === "unobservable" ||
    tasks.some((t) => t.lifecycle === "indeterminate");

  let state = "idle";
  if (tasks.length > 0 || workers.length > 0) {
    state = "active";
  } else if (
    codexRes.status === "unobservable" ||
    psStatus === "unobservable"
  ) {
    state = "unobservable";
  }

  const truncated =
    tasks.length > ACTIVITY_LIMITS.maxTasks ||
    workers.length > ACTIVITY_LIMITS.maxWorkers;

  return {
    activeCount: tasks.length + workers.length,
    state,
    tasks: tasks.slice(0, ACTIVITY_LIMITS.maxTasks),
    workers: workers.slice(0, ACTIVITY_LIMITS.maxWorkers),
    sleepPrevention: { state: "inactive", holders: [] },
    sources: [
      {
        id: "codex-tasks",
        label: "Codex tasks",
        status: codexRes.status,
        reason: codexRes.reason,
        retained: false,
      },
      {
        id: "processes",
        label: "Processes",
        status: psStatus,
        reason: psReason,
        retained: false,
      },
    ],
    observedAt: new Date(clock()).toISOString(),
    stale: false,
    partial,
    truncated,
    refreshing: false,
    notes: notes.slice(0, ACTIVITY_LIMITS.maxNotes),
  };
}

export class AgentActivityMonitor {
  constructor(options = {}) {}
  snapshot() {
    throw new Error("Not implemented");
  }
  refresh() {
    throw new Error("Not implemented");
  }
  close() {}
}
