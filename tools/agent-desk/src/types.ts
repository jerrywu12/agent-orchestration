import type { Attachment, TaskBrief } from "./intake-types";
export type Priority = "urgent" | "high" | "medium" | "low" | "none";
export type StageRole = "backlog" | "ready" | "active" | "review" | "done";
export interface Project {
  id: string;
  name: string;
  key: string;
  path?: string | null;
  repo?: string | null;
  githubProjectNumber?: number | null;
  githubProjectId?: string | null;
  statusFieldId?: string | null;
  statusOptions?: { id: string; name: string }[];
}
export interface Stage {
  id: string;
  projectId: string;
  name: string;
  color?: string | null;
  role: StageRole;
  position: number;
  autoStart?: boolean;
}
export interface Agent {
  id: string;
  name: string;
  color?: string | null;
  adapter?: string | null;
  capabilities?: Record<string, unknown> | string[] | null;
  enabled: boolean;
}
export interface Execution {
  nativeSessionId?: string | null;
  nativeSessionSource?: string | null;
  reportingReadyAt?: string | null;
  purpose?: "implementation" | "resolve_blockers";
  id: string;
  ticketId: string;
  agentId: string;
  sessionId: string;
  state: string;
  progress?: number | null;
  summary?: string | null;
  heartbeatAt?: string | null;
  branch?: string | null;
  worktreePath?: string | null;
  prUrl?: string | null;
  headSha?: string | null;
  lastSeq?: number;
  releasedAt?: string | null;
  external?: boolean;
  primaryReconciled?: boolean;
  heldSessions?: {
    sourceSessionId: string;
    sessionId: string;
    state: string;
    releasedAt?: string | null;
  }[];
}
export interface GitHubLink {
  number?: number;
  url?: string | null;
  nodeId?: string | null;
  projectItemId?: string | null;
  dirty?: boolean;
  syncState?: string | null;
  error?: string | null;
  conflict?: unknown;
}
export interface Ticket {
  brief?: TaskBrief;
  attachments?: Attachment[];
  attachmentContext?: Attachment[];
  id: string;
  projectId: string;
  number: number;
  title: string;
  description?: string | null;
  stageId: string;
  ownerId?: string | null;
  priority: Priority;
  labels?: string[] | null;
  parentId?: string | null;
  dependsOn?: string[] | null;
  blockedReason?: string | null;
  archived?: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  github?: GitHubLink | null;
  execution?: Execution | null;
}
export interface Activity {
  id: string;
  ticketId?: string | null;
  kind: string;
  summary: string;
  at: string;
  agentId?: string | null;
}
export interface SyncStatus {
  projectId: string;
  state: "idle" | "syncing" | "error" | "conflict";
  lastSyncAt?: string | null;
  error?: string | null;
  pending: number;
}
export interface DeskState {
  projects: Project[];
  stages: Stage[];
  agents: Agent[];
  tickets: Ticket[];
  activity: Activity[];
  sync: SyncStatus[];
  capabilities: { localMode: boolean };
  serverTime: string;
}
export interface Integrations {
  github: { available: boolean; login?: string; error?: string };
  agents: { id: string; available: boolean; reason?: string }[];
  migration?: Record<string, unknown>;
}
export interface Health {
  status: string;
  root: string;
  sha: string;
  version: string;
  storage: string;
}
export type TicketDraft = Pick<
  Ticket,
  | "title"
  | "description"
  | "stageId"
  | "ownerId"
  | "priority"
  | "labels"
  | "parentId"
  | "dependsOn"
  | "blockedReason"
  | "brief"
>;
export type Page = "work" | "activity" | "agents" | "machine" | "settings";

export interface AgentCapacity {
  agentId: string;
  status: "available" | "limited" | "auth_required" | "unavailable" | "unknown";
  windows: {
    id: string;
    label: string;
    usedPercent: number | null;
    remainingPercent: number | null;
    resetsAt: string | null;
    windowMinutes: number | null;
    rateLimitReachedType?: string | null;
    spendControlReached?: boolean | null;
  }[];
  source: string;
  observedAt: string | null;
  stale: boolean;
  message: string;
  ordinaryUsageAllowed?: boolean | null;
}
