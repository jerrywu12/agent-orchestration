export interface SleepHolder {
  pid: number;
  elapsedSeconds: number;
}

export interface SleepPrevention {
  state: "active" | "inactive" | "unobservable";
  holders: SleepHolder[];
}

export interface SourceObservability {
  id: "codex-tasks" | "processes";
  label: string;
  status: "observed" | "unobservable";
  reason: string | null;
  retained: boolean;
}

export interface ActiveTask {
  id: string;
  agentId: string;
  origin: "Codex" | "Codex app" | "Automation/CLI" | "Subagent";
  description: string;
  workspace: string;
  lifecycle: "active" | "indeterminate";
}

export interface ActiveWorker {
  agentId: string;
  agentName: string;
  pid: number;
  elapsedSeconds: number;
}

export interface ActivitySnapshot {
  activeCount: number;
  state: "active" | "idle" | "unobservable";
  tasks: ActiveTask[];
  workers: ActiveWorker[];
  sleepPrevention: SleepPrevention;
  sources: SourceObservability[];
  observedAt: string | null;
  stale: boolean;
  partial: boolean;
  truncated: boolean;
  refreshing: boolean;
  notes: string[];
}
