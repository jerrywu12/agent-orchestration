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

export async function collectActivity(options = {}) {
  throw new Error("Not implemented");
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
