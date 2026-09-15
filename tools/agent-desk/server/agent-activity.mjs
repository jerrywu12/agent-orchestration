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
