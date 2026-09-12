import { spawn as spawnProcess } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export const STATUS_LIMITS = Object.freeze({
  timeoutMs: 15000,
  outputBytes: 262144,
  buckets: 100,
  ttlMs: 300000,
});
const statuses = new Set([
  "available",
  "limited",
  "auth_required",
  "unavailable",
  "unknown",
]);
const reachedTypes = new Set([
  "rate_limit_reached",
  "workspace_owner_credits_depleted",
  "workspace_member_credits_depleted",
  "workspace_owner_usage_limit_reached",
  "workspace_member_usage_limit_reached",
]);
const unsupported = Object.freeze({
  claude:
    "Limits unavailable: no passive Claude quota adapter is configured. Session status-line reporting requires a separate integration.",
  gemini:
    "Limits unavailable: Gemini's quota API requires an account-specific integration; starting an interactive session is not a passive check.",
  cursor:
    "Limits unavailable: no passive Cursor quota integration is configured; browser cookies and app credentials are not extracted.",
  antigravity:
    "Limits unavailable: Antigravity quota reporting needs an explicit local integration; dynamic session servers are not probed.",
  hermes:
    "Limits unavailable: Hermes uses multiple upstream providers with separate quotas; there is no universal Hermes limit.",
  ollama:
    "Cloud limits unavailable: local Ollama runtime health does not establish cloud quota or unlimited capacity.",
  arkcli:
    "Limits unavailable: automatic ArkCLI checks are disabled because CLI startup may perform an authentication-state migration.",
});
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const boolean = (value) => (typeof value === "boolean" ? value : null);
const percent = (value) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 100
    ? value
    : null;
const duration = (value) =>
  Number.isSafeInteger(value) && value > 0 && value <= 5256000 ? value : null;
const iso = (seconds) => {
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 253402300799)
    return null;
  return new Date(seconds * 1000).toISOString();
};
const failure = (code, status = "unknown") => {
  const messages = {
    unavailable:
      "Codex CLI is unavailable in the supported installation locations.",
    auth: "Codex authentication is required or cannot provide a passive quota reading.",
    timeout: "Codex capacity refresh timed out.",
    output: "Codex capacity response exceeded the safe output limit.",
    protocol:
      "Codex capacity response was not a supported passive quota response.",
    process: "Codex capacity process did not complete the passive quota read.",
    cancelled: "Capacity refresh was cancelled.",
    refresh: "Capacity refresh failed.",
  };
  const error = new Error(messages[code] ?? messages.refresh);
  error.code = code;
  error.status = status;
  return error;
};
const reachedType = (value) =>
  reachedTypes.has(value)
    ? value
    : typeof value === "string" && value.length
      ? "unknown"
      : null;
const windowLabel = (minutes) => {
  if (minutes === null) return "Quota window";
  if (minutes % 1440 === 0) return `${minutes / 1440}-day window`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour window`;
  return `${minutes}-minute window`;
};
const blank = (agentId) => ({
  agentId,
  status: "unknown",
  windows: [],
  source: agentId === "codex" ? "codex-app-server" : "unsupported",
  observedAt: null,
  stale: true,
  message: "Provider capacity has not been observed.",
});

/** Parse only quota metadata; account identity, banners, credentials and raw errors never leave this boundary. */
export function normalizeCodexCapacity(raw) {
  if (!object(raw)) throw failure("protocol");
  let entries;
  if (
    raw.rateLimitsByLimitId !== undefined &&
    raw.rateLimitsByLimitId !== null
  ) {
    if (!object(raw.rateLimitsByLimitId)) throw failure("protocol");
    entries = Object.entries(raw.rateLimitsByLimitId);
  } else {
    if (!object(raw.rateLimits)) throw failure("protocol");
    entries = [[raw.rateLimits.limitId ?? "codex", raw.rateLimits]];
  }
  if (entries.length > STATUS_LIMITS.buckets) throw failure("output");
  const windows = [];
  let mainLimited = false;
  let scopedLimited = false;
  for (const [bucketId, bucket] of entries) {
    if (
      typeof bucketId !== "string" ||
      !/^[a-zA-Z0-9_.-]{1,100}$/.test(bucketId) ||
      !object(bucket)
    )
      throw failure("protocol");
    if (bucket.limitId != null && bucket.limitId !== bucketId)
      throw failure("protocol");
    const flags = {
      rateLimitReachedType: reachedType(bucket.rateLimitReachedType),
      spendControlReached: boolean(bucket.spendControlReached),
    };
    const limited =
      flags.rateLimitReachedType !== null || flags.spendControlReached === true;
    if (bucketId === "codex") mainLimited = limited;
    else if (limited) scopedLimited = true;
    const label = bucketId === "codex" ? "Codex" : bucketId;
    const start = windows.length;
    for (const slot of ["primary", "secondary"]) {
      const value = bucket[slot];
      if (value == null) continue;
      if (!object(value)) throw failure("protocol");
      const used = percent(value.usedPercent);
      const minutes = duration(value.windowDurationMins);
      windows.push({
        id: `${bucketId}:${slot}`,
        label: `${label} · ${windowLabel(minutes)}`,
        usedPercent: used,
        remainingPercent: used === null ? null : 100 - used,
        resetsAt: iso(value.resetsAt),
        windowMinutes: minutes,
        ...flags,
      });
    }
    if (bucket.individualLimit != null) {
      if (!object(bucket.individualLimit)) throw failure("protocol");
      const remaining = percent(bucket.individualLimit.remainingPercent);
      windows.push({
        id: `${bucketId}:individual`,
        label: `${label} · Monthly credit limit`,
        usedPercent: remaining === null ? null : 100 - remaining,
        remainingPercent: remaining,
        resetsAt: iso(bucket.individualLimit.resetsAt),
        // A calendar month is not a fixed number of minutes.
        windowMinutes: null,
        ...flags,
      });
    }
    if (limited && windows.length === start)
      windows.push({
        id: `${bucketId}:status`,
        label: `${label} · Reported limit`,
        usedPercent: null,
        remainingPercent: null,
        resetsAt: null,
        windowMinutes: null,
        ...flags,
      });
  }
  const ordinaryUsageAllowed = boolean(raw.ordinaryUsageAllowed);
  // The backend permission is distinct from credit availability and model-specific
  // buckets. A past reset or a low percentage is never permission to resume work.
  const status =
    ordinaryUsageAllowed === true
      ? "available"
      : ordinaryUsageAllowed === false || mainLimited
        ? "limited"
        : "unknown";
  let message =
    status === "available"
      ? "Codex reports that included usage is available."
      : status === "limited"
        ? "Codex reports an included-usage or spending limit."
        : "Quota metadata was read, but Codex did not provide an authoritative availability decision.";
  if (scopedLimited || (ordinaryUsageAllowed === true && mainLimited))
    message +=
      " A separate model or spending limit is also reported; see its quota window.";
  return { ...blank("codex"), status, windows, ordinaryUsageAllowed, message };
}

function codexExecutable() {
  // Fixed user/global installation locations, never a project-controlled PATH entry.
  for (const candidate of [
    join(homedir(), ".local/bin/codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  ]) {
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  throw failure("unavailable", "unavailable");
}
function protocolError(message) {
  // Classify only a bounded error string and return our own fixed wording.
  const text =
    typeof message?.error?.message === "string"
      ? message.error.message.slice(0, 2000)
      : "";
  if (
    /authentication|unauthenticated|unauthorized|not (?:logged|signed) in|login required|chatgpt auth|sign in/i.test(
      text,
    )
  )
    return failure("auth", "auth_required");
  return failure("process");
}

/**
 * One owned, bounded stdio process. It sends exactly three passive protocol messages.
 * command/spawn/timeoutMs are internal fixture seams, never HTTP request options.
 */
export async function collectCodexCapacity({
  signal,
  command,
  spawn = spawnProcess,
  timeoutMs = STATUS_LIMITS.timeoutMs,
} = {}) {
  if (signal?.aborted) throw failure("cancelled");
  const executable = command ?? codexExecutable();
  const deadlineMs = Number.isFinite(timeoutMs)
    ? Math.max(1, Math.min(STATUS_LIMITS.timeoutMs, timeoutMs))
    : STATUS_LIMITS.timeoutMs;
  const raw = await new Promise((resolve, reject) => {
    let child;
    let buffer = Buffer.alloc(0);
    let bytes = 0;
    let phase = "initialize";
    let finishing = false;
    let delivered = false;
    let completion;
    let killTimer;
    let reapTimer;
    let timer;
    const detached = process.platform !== "win32";
    const kill = (kind) => {
      if (!child) return;
      try {
        if (detached && Number.isInteger(child.pid) && child.pid > 0)
          process.kill(-child.pid, kind);
        else child.kill(kind);
      } catch {
        try {
          child.kill(kind);
        } catch {}
      }
    };
    const deliver = () => {
      if (delivered) return;
      delivered = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(reapTimer);
      signal?.removeEventListener("abort", abort);
      buffer = Buffer.alloc(0);
      if (completion?.error) reject(completion.error);
      else resolve(completion?.result);
    };
    const finish = (error, result) => {
      if (finishing) return;
      finishing = true;
      completion = { error, result };
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (!child) return deliver();
      // The detached group contains only this freshly owned CLI and its wrapper.
      kill("SIGTERM");
      killTimer = setTimeout(() => kill("SIGKILL"), 250);
      reapTimer = setTimeout(deliver, 500);
    };
    const abort = () => finish(failure("cancelled"));
    const send = (value) => {
      if (!finishing) {
        try {
          child.stdin.write(`${JSON.stringify(value)}\n`);
        } catch {
          finish(failure("process"));
        }
      }
    };
    const consume = (message) => {
      if (!object(message)) return finish(failure("protocol"));
      // Never service an authentication refresh request or any other server request.
      if (typeof message.method === "string") {
        if (Object.hasOwn(message, "id")) finish(failure("protocol"));
        return;
      }
      const expected = phase === "initialize" ? 1 : 2;
      if (message.id !== expected) return finish(failure("protocol"));
      if (Object.hasOwn(message, "error"))
        return finish(protocolError(message));
      if (!object(message.result)) return finish(failure("protocol"));
      if (phase === "initialize") {
        phase = "quota";
        send({ method: "initialized", params: {} });
        send({ id: 2, method: "account/rateLimits/read" });
      } else finish(null, message.result);
    };
    const count = (chunk) => {
      bytes += chunk.length;
      if (bytes > STATUS_LIMITS.outputBytes) {
        finish(failure("output"));
        return false;
      }
      return true;
    };
    try {
      child = spawn(executable, ["app-server", "--stdio"], {
        cwd: tmpdir(),
        shell: false,
        detached,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      child.on("error", (error) =>
        finish(
          failure(
            error?.code === "ENOENT" ? "unavailable" : "process",
            error?.code === "ENOENT" ? "unavailable" : "unknown",
          ),
        ),
      );
      child.on("close", () => {
        if (!finishing) completion = { error: failure("process") };
        finishing = true;
        deliver();
      });
      child.stdin.on("error", () => finish(failure("process")));
      child.stdout.on("data", (chunk) => {
        if (finishing || !count(chunk)) return;
        buffer = Buffer.concat([buffer, chunk]);
        let newline;
        while (!finishing && (newline = buffer.indexOf(10)) !== -1) {
          const line = buffer.subarray(0, newline).toString("utf8");
          buffer = buffer.subarray(newline + 1);
          if (!line.trim()) continue;
          let value;
          try {
            value = JSON.parse(line);
          } catch {
            finish(failure("protocol"));
            break;
          }
          consume(value);
        }
      });
      child.stderr.on("data", (chunk) => {
        if (!finishing) count(chunk);
      });
      child.stdout.on("error", () => finish(failure("process")));
      child.stderr.on("error", () => finish(failure("process")));
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => finish(failure("timeout")), deadlineMs);
      if (signal?.aborted) return abort();
      send({
        id: 1,
        method: "initialize",
        params: {
          clientInfo: {
            name: "agent_desk",
            title: "Agent Desk",
            version: "1.0.0",
          },
        },
      });
    } catch {
      finish(failure("process"));
    }
  });
  if (signal?.aborted) throw failure("cancelled");
  return {
    ...normalizeCodexCapacity(raw),
    observedAt: new Date().toISOString(),
    stale: false,
  };
}

/** Memory-only observations. Injecting collectors replaces the native collector map entirely. */
export class AgentStatusMonitor {
  constructor({
    agents = [],
    collectors,
    clock = Date.now,
    ttlMs = STATUS_LIMITS.ttlMs,
  } = {}) {
    this.agents = [...new Set(agents.filter((id) => typeof id === "string"))];
    this.collectors = collectors ?? { codex: collectCodexCapacity };
    this.clock = clock;
    this.ttlMs =
      Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : STATUS_LIMITS.ttlMs;
    this.observations = new Map(this.agents.map((id) => [id, blank(id)]));
    this.lastAttempts = new Map();
    this.controllers = new Set();
    this.pending = null;
    this.closed = false;
  }
  snapshot() {
    const now = Number(this.clock());
    return {
      agents: this.agents.map((id) => {
        const value = this.observations.get(id);
        const expired = value.windows.some(
          (w) => w.resetsAt && Date.parse(w.resetsAt) <= now,
        );
        return structuredClone({
          ...value,
          stale:
            value.stale ||
            value.observedAt === null ||
            now - Date.parse(value.observedAt) >= this.ttlMs ||
            expired,
        });
      }),
      refreshing: this.pending !== null,
    };
  }
  refresh({ force = false } = {}) {
    if (this.closed) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = Promise.all(
      this.agents.map((id) => this.collect(id, force)),
    ).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  async collect(agentId, force) {
    const now = Number(this.clock());
    const attempted = this.lastAttempts.get(agentId);
    if (!force && attempted !== undefined && now - attempted < this.ttlMs)
      return;
    this.lastAttempts.set(agentId, now);
    const controller = new AbortController();
    this.controllers.add(controller);
    let abort;
    const cancelled = new Promise((_, reject) => {
      abort = () => reject(failure("cancelled"));
      controller.signal.addEventListener("abort", abort, { once: true });
    });
    const timer = setTimeout(
      () => controller.abort(),
      STATUS_LIMITS.timeoutMs + 1000,
    );
    try {
      const collector = Object.hasOwn(this.collectors, agentId)
        ? this.collectors[agentId]
        : null;
      const task =
        typeof collector === "function"
          ? collector({ signal: controller.signal })
          : {
              ...blank(agentId),
              status: "unavailable",
              source: "unsupported",
              message: Object.hasOwn(unsupported, agentId)
                ? unsupported[agentId]
                : "Limits unavailable: no passive quota adapter is configured for this provider.",
            };
      const value = await Promise.race([task, cancelled]);
      if (this.closed) return;
      if (
        !object(value) ||
        !statuses.has(value.status) ||
        !Array.isArray(value.windows) ||
        value.windows.length > 400
      )
        throw failure("protocol");
      this.observations.set(agentId, {
        ...value,
        agentId,
        observedAt: new Date(Number(this.clock())).toISOString(),
        stale: false,
      });
    } catch (error) {
      if (this.closed) return;
      const previous = this.observations.get(agentId);
      const known =
        error instanceof Error &&
        error.code &&
        [
          "unavailable",
          "auth",
          "timeout",
          "output",
          "protocol",
          "process",
          "cancelled",
        ].includes(error.code);
      const safe = known
        ? failure(error.code, error.status)
        : failure("refresh");
      this.observations.set(agentId, {
        ...previous,
        status: statuses.has(safe.status) ? safe.status : "unknown",
        stale: true,
        observedAt:
          previous.observedAt ?? new Date(Number(this.clock())).toISOString(),
        message: `${safe.message}${previous.observedAt ? " Last observed limits are retained." : ""}`,
      });
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", abort);
      this.controllers.delete(controller);
    }
  }
  close() {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
  }
}
