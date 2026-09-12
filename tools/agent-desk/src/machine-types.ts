export interface MachineProcess {
  pid: number;
  cpuPercent: number;
  memoryBytes: number;
}
export interface MachineAgent {
  id: string;
  name: string;
  kind: "agent" | "tool";
  installed: boolean;
  version: string | null;
  path: string | null;
  deskAgentId?: string | null;
  status: "running" | "idle" | "unknown";
  processes: MachineProcess[];
  cpuPercent: number | null;
  memoryBytes: number | null;
}
export interface MachineLibrary {
  id: string;
  name: string;
  version: string | null;
  requestedVersion?: string | null;
  ecosystem: "npm" | "python" | "plugin";
  sourceId: string;
  status: "installed" | "declared" | "cached";
  path: string;
}
export interface MachineSource {
  id: string;
  label: string;
  path: string;
  kind: "npm" | "python" | "project" | "custom" | "apps" | "tools";
  status: "scanned" | "missing" | "error" | "partial";
  packageCount: number;
  detail?: string | null;
}
export interface CustomMachineSource {
  id: string;
  label: string;
  path: string;
  version?: number;
}
export interface MachineService {
  id: string;
  name: string;
  endpoint: string;
  status: "healthy" | "unreachable" | "unknown";
  latencyMs: number | null;
  detail: string;
}
export interface MachineHost {
  name: string;
  platform: string;
  arch: string;
  memoryTotalBytes: number;
  memoryFreeBytes: number;
  loadAverage: number[];
  uptimeSeconds: number;
}
export interface MachineSnapshot {
  host: MachineHost | null;
  agents: MachineAgent[];
  libraries: MachineLibrary[];
  sources: MachineSource[];
  services: MachineService[];
  customSources: CustomMachineSource[];
  scan: {
    state: "idle" | "scanning" | "error";
    inventoryAt: string | null;
    runtimeAt: string | null;
    error: string | null;
    runtimeError: string | null;
    issues: string[];
    truncated: boolean;
  };
  limits: {
    inventoryIntervalMs: number;
    runtimeIntervalMs: number;
    maxCustomSources: number;
  };
}
