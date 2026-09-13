export interface RunResult {
  ticketId: string;
  status:
    | "queued"
    | "running"
    | "already_running"
    | "needs_takeover"
    | "skipped"
    | "failed"
    | "checkpointed"
    | "awaiting_review";
  message: string;
  executionId?: string;
  telemetry?: {
    state: string;
    summary: string;
    progress: number | null;
    startedAt: string | null;
    heartbeatAt: string | null;
    lastActivityAt: string | null;
    releasedAt: string | null;
    reportingReadyAt: string | null;
    stale: boolean;
  };
}
export interface BulkRun {
  id: string;
  state: "running" | "complete";
  concurrency: number;
  results: RunResult[];
  createdAt: string;
  observedAt: string;
}
export interface ArchiveResult {
  ticketId: string;
  status: "archived" | "skipped" | "failed";
  message: string;
}
export interface ExecutionStatus {
  ticketId: string;
  executionId: string | null;
  sessionId: string | null;
  nativeSessionId: string | null;
  nativeThreadUrl: string | null;
  state: string | null;
  tracking: "managed" | "process" | "recorded" | "untraceable" | "none";
  processAlive: boolean | null;
  stale: boolean;
  canTakeOver: boolean;
  reason: string;
  evidence: string[];
  worktreePath: string | null;
  branch: string | null;
  lastHeartbeatAt: string | null;
  history: {
    id: string;
    state: string;
    summary: string | null;
    startedAt: string;
    releasedAt: string | null;
    nativeSessionId?: string | null;
  }[];
}
