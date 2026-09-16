// Keeps the Mac awake while AI agent work is actually in flight, without
// keeping the screen on.
//
// This replaces the retired `agent_caffeinate_watch.sh` LaunchAgent. That
// script maintained its own hardcoded pgrep list which drifted from reality
// (it never knew about Cursor or ArkCLI). Agent Desk already performs the
// detection, so the hold is driven from the same observation the Machine view
// and the menu bar show, and there is only one list to keep correct.
//
// Deliberately holds only idle-system-sleep and system-sleep assertions:
// `caffeinate -i -s`, never `-d`. The display still sleeps on its normal
// schedule and the screen lock still engages, so a long unattended run stays
// alive without leaving the machine unlocked.

import { spawn as spawnProcess } from "node:child_process";

export const KEEP_AWAKE_LIMITS = Object.freeze({
  // Matches the activity monitor's own cadence; a hold is re-evaluated every
  // time a fresh observation could have changed the answer.
  intervalMs: 15000,
  // A hold is never extended on evidence older than this. If observation
  // breaks, the machine returns to its normal power behaviour rather than
  // staying awake indefinitely on a stale snapshot.
  maxStaleMs: 120000,
  // Absolute ceiling on a single uninterrupted hold, re-armed while work
  // genuinely continues. Bounds the blast radius of a stuck detector.
  maxHoldMs: 12 * 60 * 60 * 1000,
});

// Agents whose presence means work is in flight. Helper daemons are excluded:
// Hermes runs as an MCP server spawned by another agent and Ollama is a model
// runtime, so both can be alive with nothing happening. Counting them would pin
// the machine awake permanently -- on this machine Hermes alone accounts for
// most of the running workers. The retired script excluded them for the same
// reason, though it never wrote down why.
export const KEEP_AWAKE_AGENTS = Object.freeze([
  "codex",
  "claude",
  "gemini",
  "agy",
  "cursor",
  "arkcli",
]);

/** Work that justifies holding the machine awake. Codex counts at task
 * granularity, every other agent at worker granularity, matching how the
 * snapshot itself counts (R-010). */
export function keepAwakeDemand(snapshot, agents = KEEP_AWAKE_AGENTS) {
  if (!snapshot || typeof snapshot !== "object") return { tasks: 0, workers: 0 };
  const allowed = new Set(agents);
  const tasks = Array.isArray(snapshot.tasks)
    ? snapshot.tasks.filter((t) => allowed.has(t?.agentId)).length
    : 0;
  const workers = Array.isArray(snapshot.workers)
    ? snapshot.workers.filter((w) => allowed.has(w?.agentId)).length
    : 0;
  return { tasks, workers };
}

export class SleepCoordinator {
  constructor({
    activityMonitor,
    enabled = true,
    agents = KEEP_AWAKE_AGENTS,
    spawn = spawnProcess,
    clock = Date.now,
    auto = true,
    intervalMs = KEEP_AWAKE_LIMITS.intervalMs,
    maxStaleMs = KEEP_AWAKE_LIMITS.maxStaleMs,
    maxHoldMs = KEEP_AWAKE_LIMITS.maxHoldMs,
  } = {}) {
    this.activityMonitor = activityMonitor;
    this.enabled = enabled !== false;
    this.agents = [...agents];
    this.spawn = spawn;
    this.clock = clock;
    this.intervalMs = intervalMs;
    this.maxStaleMs = maxStaleMs;
    this.maxHoldMs = maxHoldMs;
    this.child = null;
    this.heldSince = null;
    this.lastReason = "Not holding: no agent work observed.";
    this.closed = false;
    this.signals = [];
    if (auto) {
      this.evaluate();
      this.timer = setInterval(() => this.evaluate(), this.intervalMs);
      this.timer.unref?.();
      // An HTTP server close handler is not enough: launchd stops the service
      // with SIGTERM, which exits node without closing the server, and the
      // assertion would be orphaned and hold the machine awake forever with
      // nothing left to release it. Release on the way out, whatever the route.
      const release = () => this.release();
      for (const signal of ["exit", "SIGTERM", "SIGINT", "SIGHUP"]) {
        const handler =
          signal === "exit"
            ? release
            : () => {
                release();
                process.exit(0);
              };
        process.on(signal, handler);
        this.signals.push([signal, handler]);
      }
    }
  }

  state() {
    return {
      enabled: this.enabled,
      holding: this.child !== null,
      pid: this.child?.pid ?? null,
      heldSince: this.heldSince ? new Date(this.heldSince).toISOString() : null,
      reason: this.lastReason,
      // Stated explicitly because it is the whole point of the feature: the
      // display is never held on, so the screen still locks.
      preventsDisplaySleep: false,
      agents: [...this.agents],
    };
  }

  /** Decide whether a hold is justified right now, and say why. */
  decide(snapshot, now) {
    if (!this.enabled)
      return { hold: false, reason: "Not holding: keep-awake is disabled." };
    if (!snapshot || snapshot.observedAt === null)
      return { hold: false, reason: "Not holding: activity has not been observed yet." };
    const age = now - Date.parse(snapshot.observedAt);
    if (!Number.isFinite(age) || age > this.maxStaleMs)
      return {
        hold: false,
        reason: "Not holding: the last activity observation is too old to act on.",
      };
    const { tasks, workers } = keepAwakeDemand(snapshot, this.agents);
    if (tasks + workers === 0)
      return { hold: false, reason: "Not holding: no agent work observed." };
    if (
      this.heldSince !== null &&
      now - this.heldSince > this.maxHoldMs
    )
      return {
        hold: false,
        reason: "Not holding: the maximum continuous hold was reached.",
      };
    const parts = [];
    if (tasks) parts.push(`${tasks} task${tasks === 1 ? "" : "s"}`);
    if (workers) parts.push(`${workers} worker${workers === 1 ? "" : "s"}`);
    return {
      hold: true,
      reason: `Holding: ${parts.join(" and ")} in flight. The display still sleeps and the screen still locks.`,
    };
  }

  evaluate() {
    if (this.closed) return this.state();
    const now = Number(this.clock());
    let snapshot = null;
    try {
      snapshot = this.activityMonitor?.snapshot?.() ?? null;
    } catch {
      snapshot = null;
    }
    const { hold, reason } = this.decide(snapshot, now);
    this.lastReason = reason;
    if (hold) this.acquire(now);
    else this.release();
    return this.state();
  }

  acquire(now) {
    if (this.child) return;
    try {
      // -i prevents idle system sleep, -s prevents system sleep on AC power.
      // -d is deliberately absent so the display sleeps and the screen locks.
      const child = this.spawn("/usr/bin/caffeinate", ["-i", "-s"], {
        stdio: "ignore",
        detached: false,
        windowsHide: true,
      });
      child.on("error", () => {
        if (this.child === child) {
          this.child = null;
          this.heldSince = null;
          this.lastReason = "Not holding: the sleep assertion could not be started.";
        }
      });
      child.on("exit", () => {
        if (this.child === child) {
          this.child = null;
          this.heldSince = null;
        }
      });
      child.unref?.();
      this.child = child;
      this.heldSince = now;
    } catch {
      this.child = null;
      this.heldSince = null;
      this.lastReason = "Not holding: the sleep assertion could not be started.";
    }
  }

  release() {
    const child = this.child;
    if (!child) return;
    this.child = null;
    this.heldSince = null;
    try {
      child.kill("SIGTERM");
    } catch {}
  }

  close() {
    this.closed = true;
    clearInterval(this.timer);
    for (const [signal, handler] of this.signals)
      process.removeListener(signal, handler);
    this.signals = [];
    // Never outlive the server: a stranded caffeinate would keep the machine
    // awake with nothing left to observe it.
    this.release();
  }
}
