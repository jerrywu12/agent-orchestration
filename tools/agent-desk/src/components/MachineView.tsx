import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  Box,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cpu,
  FolderOpen,
  HardDrive,
  Layers3,
  Monitor,
  Plus,
  RefreshCw,
  Search,
  Server,
  Trash2,
} from "lucide-react";
import { api, errorMessage, pathId } from "../api";
import type { MachineSnapshot } from "../machine-types";
import type { DeskState } from "../types";
import { EmptyState, isActive, ticketKey, timeAgo } from "./shared";

type MachineTab = "agents" | "libraries" | "sources";
const POLL_INTERVAL = 15000;

function isOlder(next: string | null, previous: string | null) {
  return !!previous && (!next || Date.parse(next) < Date.parse(previous));
}

function useMachine() {
  const [snapshot, setSnapshot] = useState<MachineSnapshot | null>(null);
  const [error, setError] = useState("");
  const [older, setOlder] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const latest = useRef<MachineSnapshot | null>(null);
  const mounted = useRef(false);
  const requestNumber = useRef(0);
  const loading = useRef(false);
  const mutating = useRef(false);

  const accept = useCallback((value: MachineSnapshot) => {
    const previous = latest.current;
    const inventoryOlder =
      !!previous && isOlder(value.scan.inventoryAt, previous.scan.inventoryAt);
    const runtimeOlder =
      !!previous && isOlder(value.scan.runtimeAt, previous.scan.runtimeAt);
    const hasNewObservation =
      !!previous &&
      (isOlder(previous.scan.inventoryAt, value.scan.inventoryAt) ||
        isOlder(previous.scan.runtimeAt, value.scan.runtimeAt));
    if (previous && (inventoryOlder || runtimeOlder) && !hasNewObservation) {
      const retained = { ...previous, customSources: value.customSources };
      latest.current = retained;
      setSnapshot(retained);
      setOlder(true);
      setError("");
      return;
    }
    // A restarted server can discover fresh metadata before runtime probing
    // succeeds. Keep its unknown metrics and error instead of blocking inventory.
    let accepted = value;
    if (previous && inventoryOlder) {
      const runtimeById = new Map(
        value.agents.map((agent) => [agent.id, agent]),
      );
      accepted = {
        ...value,
        libraries: previous.libraries,
        sources: previous.sources,
        agents: previous.agents.map((agent) => {
          const runtime = runtimeById.get(agent.id);
          return {
            ...agent,
            status: runtime?.status ?? "unknown",
            processes: runtime?.processes ?? [],
            cpuPercent: runtime?.cpuPercent ?? null,
            memoryBytes: runtime?.memoryBytes ?? null,
          };
        }),
        scan: {
          ...value.scan,
          inventoryAt: previous.scan.inventoryAt,
          error:
            value.scan.error ||
            "Inventory discovery has no newer observation. Previous inventory is retained.",
          issues: previous.scan.issues,
          truncated: previous.scan.truncated,
        },
      };
    }
    if (runtimeOlder) {
      accepted = {
        ...accepted,
        scan: {
          ...accepted.scan,
          runtimeError:
            value.scan.runtimeError ||
            "Runtime observations are older than the previously displayed sample.",
        },
      };
    }
    latest.current = accepted;
    setSnapshot(accepted);
    setError("");
    setOlder(false);
  }, []);

  const reload = useCallback(async () => {
    const currentRequest = ++requestNumber.current;
    loading.current = true;
    try {
      const value = await api<MachineSnapshot>("/machine");
      if (mounted.current && currentRequest === requestNumber.current)
        accept(value);
    } catch (failure) {
      if (mounted.current && currentRequest === requestNumber.current)
        setError(errorMessage(failure));
    } finally {
      if (currentRequest === requestNumber.current) loading.current = false;
    }
  }, [accept]);

  useEffect(() => {
    mounted.current = true;
    void reload();
    const interval = window.setInterval(() => {
      if (!document.hidden && !loading.current && !mutating.current)
        void reload();
    }, POLL_INTERVAL);
    const visible = () => {
      if (!document.hidden && !mutating.current) void reload();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      mounted.current = false;
      requestNumber.current += 1;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [reload]);

  async function mutate(
    name: string,
    path: string,
    method: string,
    body?: unknown,
  ) {
    setBusy(name);
    setError("");
    setNotice("");
    mutating.current = true;
    loading.current = false;
    const mutation = ++requestNumber.current;
    try {
      const value = await api<MachineSnapshot>(path, method, body);
      if (!mounted.current || mutation !== requestNumber.current) return false;
      if (name === "refresh") {
        accept(value);
        setNotice(
          "Refresh requested. Previous observations remain visible while the server scans.",
        );
      } else {
        setNotice(
          name === "add"
            ? "Folder added to monitoring."
            : "Folder removed from monitoring.",
        );
        await reload();
      }
      return true;
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure));
      return false;
    } finally {
      mutating.current = false;
      if (mounted.current) setBusy("");
    }
  }

  return { snapshot, error, older, busy, notice, reload, mutate };
}

function bytes(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.max(
    0,
    Math.min(
      units.length - 1,
      Math.floor(Math.log(Math.max(1, value)) / Math.log(1024)),
    ),
  );
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: index > 2 ? 1 : 0 }).format(value / 1024 ** index)} ${units[index]}`;
}
const percent = (value: number | null) =>
  typeof value === "number" && Number.isFinite(value)
    ? `${value.toFixed(1)}%`
    : "—";
function uptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return days
    ? `${days}d ${hours}h`
    : hours
      ? `${hours}h ${Math.floor((seconds % 3600) / 60)}m`
      : `${Math.floor(seconds / 60)}m`;
}

export function MachineView({
  state,
  onOpen,
}: {
  state: DeskState;
  onOpen: (id: string) => void;
}) {
  const machine = useMachine();
  const [tab, setTab] = useState<MachineTab>("agents");
  const tabRefs = useRef<Partial<Record<MachineTab, HTMLButtonElement | null>>>(
    {},
  );
  const snapshot = machine.snapshot;
  const tabs = [
    {
      id: "agents",
      label: "Agents & tools",
      count: snapshot?.agents.length ?? 0,
      icon: Cpu,
    },
    {
      id: "libraries",
      label: "Libraries",
      count: snapshot?.libraries.length ?? 0,
      icon: Box,
    },
    {
      id: "sources",
      label: "Sources",
      count: snapshot?.sources.length ?? 0,
      icon: FolderOpen,
    },
  ] as const;
  function tabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const offset =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : offset
            ? (index + offset + tabs.length) % tabs.length
            : null;
    if (next === null) return;
    event.preventDefault();
    setTab(tabs[next].id);
    tabRefs.current[tabs[next].id]?.focus();
  }
  const problems = [
    machine.error,
    machine.older
      ? "The server returned an older observation. Showing the most recent retained data."
      : "",
    snapshot?.scan.error,
    snapshot?.scan.runtimeError,
  ].filter(Boolean);
  return (
    <div className="machine-page">
      <header className="machine-heading">
        <div>
          <div className="page-kicker">WORKSPACE / SERVER OBSERVATIONS</div>
          <h1>Machine</h1>
          <p>
            A clear view of the tools, services, and libraries on this host.
          </p>
        </div>
        <button
          className="button primary"
          aria-label="Refresh machine"
          disabled={!!machine.busy || snapshot?.scan.state === "scanning"}
          onClick={() =>
            void machine.mutate("refresh", "/machine/refresh", "POST")
          }
        >
          <RefreshCw
            size={14}
            className={snapshot?.scan.state === "scanning" ? "spin" : ""}
          />
          {snapshot?.scan.state === "scanning" ? "Scanning…" : "Refresh"}
        </button>
      </header>
      {problems.length > 0 && (
        <div className="machine-alert" role="alert">
          <CircleHelp size={16} />
          <div>
            {snapshot && (
              <strong>
                {machine.error || machine.older
                  ? "Previous observations are retained."
                  : "Some observations are unavailable or stale."}
              </strong>
            )}
            {problems.map((problem, index) => (
              <p key={index}>{problem}</p>
            ))}
          </div>
          <button
            className="text-button"
            aria-label="Retry machine connection"
            onClick={() => void machine.reload()}
          >
            <RefreshCw size={13} />
            Retry
          </button>
        </div>
      )}
      {machine.notice && (
        <div className="machine-notice" role="status">
          <Check size={13} />
          {machine.notice}
        </div>
      )}
      {!snapshot ? (
        <div
          className="machine-loading"
          aria-busy="true"
          aria-label="Loading machine observations"
        >
          <div />
          <div />
          <div />
          <p>Loading machine observations…</p>
        </div>
      ) : (
        <>
          {snapshot.host ? (
            <HostStrip snapshot={snapshot} />
          ) : (
            <div className="machine-first-observation">
              <Monitor size={24} />
              <div>
                <strong>Waiting for the first observation</strong>
                <p>
                  {snapshot.scan.state === "scanning"
                    ? "The server is collecting its first bounded inventory."
                    : "Refresh to observe this host."}
                </p>
              </div>
            </div>
          )}
          <div className="machine-freshness">
            <ObservationTime
              label="Runtime"
              at={snapshot.scan.runtimeAt}
              staleAfter={snapshot.limits.runtimeIntervalMs * 3}
              failed={!!snapshot.scan.runtimeError}
            />
            <ObservationTime
              label="Inventory"
              at={snapshot.scan.inventoryAt}
              staleAfter={snapshot.limits.inventoryIntervalMs * 2}
              failed={!!snapshot.scan.error}
            />
            <span className="machine-cadence">
              <span
                className={`live-dot ${snapshot.scan.state === "scanning" ? "quiet" : ""}`}
              />
              15s runtime · 5m inventory
            </span>
          </div>
          {snapshot.scan.truncated && (
            <p className="machine-limit-note">
              <CircleHelp size={13} />
              Inventory limits were reached. Source coverage shows the
              boundaries of this observation.
            </p>
          )}
          <div
            className="machine-tabs"
            role="tablist"
            aria-label="Machine sections"
          >
            {tabs.map((item, index) => (
              <button
                key={item.id}
                ref={(element) => {
                  tabRefs.current[item.id] = element;
                }}
                role="tab"
                id={`machine-tab-${item.id}`}
                aria-selected={tab === item.id}
                aria-controls={`machine-panel-${item.id}`}
                tabIndex={tab === item.id ? 0 : -1}
                onKeyDown={(event) => tabKey(event, index)}
                onClick={() => setTab(item.id)}
              >
                <item.icon size={14} />
                <span>{item.label}</span>
                <span className="machine-tab-count">{item.count}</span>
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`machine-panel-${tab}`}
            aria-labelledby={`machine-tab-${tab}`}
            className="machine-panel"
          >
            {tab === "agents" ? (
              <>
                <AgentInventory
                  snapshot={snapshot}
                  state={state}
                  onOpen={onOpen}
                />
                <Services snapshot={snapshot} />
              </>
            ) : tab === "libraries" ? (
              <Libraries snapshot={snapshot} />
            ) : (
              <Sources
                snapshot={snapshot}
                busy={machine.busy}
                mutate={machine.mutate}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ObservationTime({
  label,
  at,
  staleAfter,
  failed,
}: {
  label: string;
  at: string | null;
  staleAfter: number;
  failed: boolean;
}) {
  const stale =
    !!at &&
    (failed ||
      !Number.isFinite(Date.parse(at)) ||
      Date.now() - Date.parse(at) > staleAfter);
  return (
    <span
      title={at || "Not observed yet"}
      className={stale ? "machine-time-stale" : ""}
    >
      <Clock3 size={12} />
      {label}: {at ? timeAgo(at) : "not observed"}
      {stale ? " · stale" : ""}
    </span>
  );
}

function HostStrip({ snapshot }: { snapshot: MachineSnapshot }) {
  const host = snapshot.host!;
  const used = Math.max(0, host.memoryTotalBytes - host.memoryFreeBytes);
  const platform =
    (
      { darwin: "macOS", linux: "Linux", win32: "Windows" } as Record<
        string,
        string
      >
    )[host.platform] || host.platform;
  return (
    <div className="machine-host-strip" aria-label="Host resources">
      <div className="machine-host-identity">
        <span className="machine-host-icon">
          <Monitor size={21} />
        </span>
        <div>
          <strong>{host.name}</strong>
          <span>
            {platform} · {host.arch}
          </span>
        </div>
      </div>
      <div className="machine-host-stat">
        <span>
          <HardDrive size={12} />
          Memory used
        </span>
        <strong>
          {bytes(used)} <small>/ {bytes(host.memoryTotalBytes)}</small>
        </strong>
        <progress
          aria-label="Host memory used"
          max={Math.max(1, host.memoryTotalBytes)}
          value={used}
        />
      </div>
      <div className="machine-host-stat">
        <span>
          <Activity size={12} />
          Load average
        </span>
        <strong>
          {host.loadAverage.map((value) => value.toFixed(2)).join(" / ")}
        </strong>
        <small>1 / 5 / 15 minutes</small>
      </div>
      <div className="machine-host-stat">
        <span>
          <Clock3 size={12} />
          Uptime
        </span>
        <strong>{uptime(host.uptimeSeconds)}</strong>
        <small>Host observation</small>
      </div>
    </div>
  );
}

function AgentInventory({
  snapshot,
  state,
  onOpen,
}: {
  snapshot: MachineSnapshot;
  state: DeskState;
  onOpen: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const agents = snapshot.agents.filter(
    (agent) =>
      (!kind || agent.kind === kind) &&
      `${agent.name} ${agent.path || ""}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  return (
    <section aria-label="Agent and tool inventory">
      <div className="machine-list-toolbar">
        <div className="machine-search">
          <Search size={14} />
          <input
            type="search"
            aria-label="Search agents and tools"
            placeholder="Search agents and tools…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <select
          aria-label="Tool kind"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          <option value="">Agents & tools</option>
          <option value="agent">Agents</option>
          <option value="tool">Tools</option>
        </select>
        <span className="machine-toolbar-note">Observation only</span>
      </div>
      {!agents.length ? (
        <EmptyState
          title={
            snapshot.agents.length
              ? "No matching agents or tools"
              : "No agents or tools discovered"
          }
        >
          {snapshot.scan.state === "scanning"
            ? "The first scan is still in progress. Existing installations will appear when observed."
            : "Check source coverage or add a folder to extend this inventory."}
        </EmptyState>
      ) : (
        <div className="machine-table-wrap">
          <table className="machine-data-table machine-agent-table">
            <caption className="sr-only">Agent and tool inventory</caption>
            <thead>
              <tr>
                <th scope="col">Agent / tool</th>
                <th scope="col">Installation</th>
                <th scope="col">Observed runtime</th>
                <th scope="col">CPU</th>
                <th scope="col">RSS memory</th>
                <th scope="col">Registered work</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => {
                const assigned = agent.deskAgentId
                  ? state.tickets.filter(
                      (ticket) =>
                        ticket.ownerId === agent.deskAgentId &&
                        !ticket.archived,
                    )
                  : [];
                const reserved = assigned.filter((ticket) =>
                  isActive(ticket.execution),
                );
                return (
                  <Fragment key={agent.id}>
                    <tr>
                      <td data-label="Agent / tool">
                        <button
                          className="machine-agent-name"
                          aria-label={`Inspect ${agent.name}`}
                          aria-expanded={expanded === agent.id}
                          onClick={() =>
                            setExpanded(expanded === agent.id ? null : agent.id)
                          }
                        >
                          <span
                            className={`machine-item-icon ${agent.kind === "tool" ? "machine-tool-icon" : ""}`}
                          >
                            {agent.kind === "agent" ? (
                              <Cpu size={15} />
                            ) : (
                              <Layers3 size={15} />
                            )}
                          </span>
                          <span>
                            <strong>{agent.name}</strong>
                            <small>
                              {agent.kind === "agent"
                                ? "Agent"
                                : "Supporting tool"}
                            </small>
                          </span>
                          <ChevronDown size={12} />
                        </button>
                      </td>
                      <td data-label="Installation">
                        <span
                          className={`machine-status ${agent.installed ? "installed" : "unknown"}`}
                        >
                          <span />
                          {agent.installed ? "Installed" : "Not found"}
                        </span>
                        <small className="machine-cell-secondary">
                          {agent.version ||
                            (agent.installed
                              ? "Version unavailable"
                              : "No installation evidence")}
                        </small>
                      </td>
                      <td data-label="Observed runtime">
                        <span className={`machine-status ${agent.status}`}>
                          <span />
                          {agent.status === "running"
                            ? "Running"
                            : agent.status === "idle"
                              ? "No matched process"
                              : "Unknown"}
                        </span>
                        {agent.processes.length > 0 && (
                          <small className="machine-cell-secondary">
                            {agent.processes.length}{" "}
                            {agent.processes.length === 1
                              ? "process"
                              : "processes"}
                            {snapshot.scan.runtimeError
                              ? " · retained sample"
                              : ""}
                          </small>
                        )}
                      </td>
                      <td data-label="CPU" className="machine-numeric">
                        {percent(agent.cpuPercent)}
                      </td>
                      <td data-label="RSS memory" className="machine-numeric">
                        {bytes(agent.memoryBytes)}
                      </td>
                      <td data-label="Registered work">
                        {agent.deskAgentId ? (
                          <span className="machine-work-count">
                            {assigned.length}{" "}
                            {assigned.length === 1 ? "ticket" : "tickets"}
                            <small>{reserved.length} reserved</small>
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                    {expanded === agent.id && (
                      <tr className="machine-expanded-row">
                        <td colSpan={6}>
                          <div className="machine-agent-detail">
                            <div>
                              <h3>Installation path</h3>
                              <code>{agent.path || "No path observed"}</code>
                              {agent.processes.length > 0 && (
                                <>
                                  <h3>Observed processes</h3>
                                  <ul className="machine-process-list">
                                    {agent.processes.map((process) => (
                                      <li key={process.pid}>
                                        <span>
                                          PID <b>{process.pid}</b>
                                        </span>
                                        <span>
                                          {percent(process.cpuPercent)} CPU
                                        </span>
                                        <span>
                                          {bytes(process.memoryBytes)} RSS
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                </>
                              )}
                            </div>
                            {agent.deskAgentId && (
                              <div>
                                <h3>Registered work</h3>
                                <p>
                                  Ticket responsibility and reserved sessions
                                  are tracked independently from these
                                  processes.
                                </p>
                                {assigned.length ? (
                                  assigned.slice(0, 20).map((ticket) => (
                                    <button
                                      className="machine-task-button"
                                      key={ticket.id}
                                      onClick={() => onOpen(ticket.id)}
                                    >
                                      <span className="ticket-id">
                                        {ticketKey(ticket, state.projects)}
                                      </span>
                                      <span>{ticket.title}</span>
                                      <ArrowUpRight size={12} />
                                    </button>
                                  ))
                                ) : (
                                  <p>No assigned tickets.</p>
                                )}
                                {assigned.length > 20 && (
                                  <p>
                                    {assigned.length - 20} more tickets are
                                    available in All work.
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="machine-footnote">
        <CircleHelp size={12} />
        Installed tools may have no matched process. Generic Node and Python
        processes are not assigned to an agent. RSS can include shared memory.
      </p>
    </section>
  );
}

function Services({ snapshot }: { snapshot: MachineSnapshot }) {
  return (
    <section className="machine-service-section">
      <div className="machine-section-title">
        <h2>
          <Server size={15} />
          Local services
        </h2>
        <span>{snapshot.services.length} endpoints observed</span>
      </div>
      {snapshot.services.length ? (
        <div className="machine-table-wrap">
          <table className="machine-data-table machine-service-table">
            <caption className="sr-only">Local service health</caption>
            <thead>
              <tr>
                <th scope="col">Service / endpoint</th>
                <th scope="col">Responsiveness</th>
                <th scope="col">Latency</th>
                <th scope="col">Observation</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.services.map((service) => (
                <tr key={service.id}>
                  <td data-label="Service">
                    <strong className="machine-service-name">
                      {service.name}
                    </strong>
                    <code className="machine-cell-secondary">
                      {service.endpoint}
                    </code>
                  </td>
                  <td data-label="Responsiveness">
                    <span className={`machine-status ${service.status}`}>
                      <span />
                      {service.status === "healthy"
                        ? "Responsive"
                        : service.status === "unreachable"
                          ? "Unreachable"
                          : "Unknown"}
                    </span>
                  </td>
                  <td data-label="Latency" className="machine-numeric">
                    {service.latencyMs === null
                      ? "—"
                      : `${service.latencyMs} ms`}
                  </td>
                  <td
                    data-label="Observation"
                    className="machine-service-detail"
                  >
                    {service.detail}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="machine-empty-inline">No service observations yet.</p>
      )}
      <p className="machine-footnote">
        Endpoint responsiveness does not verify model availability,
        authentication, or readiness to run a task.
      </p>
    </section>
  );
}

function Libraries({ snapshot }: { snapshot: MachineSnapshot }) {
  const [search, setSearch] = useState("");
  const [ecosystem, setEcosystem] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [expanded, setExpanded] = useState<string | null>(null);
  const filtered = useMemo(
    () =>
      snapshot.libraries
        .filter(
          (library) =>
            (!ecosystem || library.ecosystem === ecosystem) &&
            (!source || library.sourceId === source) &&
            (!status || library.status === status) &&
            library.name.toLowerCase().includes(search.trim().toLowerCase()),
        )
        .sort(
          (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
        ),
    [snapshot.libraries, search, ecosystem, source, status],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const offset = (currentPage - 1) * pageSize;
  const visible = filtered.slice(offset, offset + pageSize);
  function reset() {
    setSearch("");
    setEcosystem("");
    setSource("");
    setStatus("");
    setPage(1);
  }
  return (
    <section aria-label="Library inventory">
      <div className="machine-library-intro">
        <p>
          Installed packages, project declarations, and cached plugins, with
          their source preserved.
        </p>
        <span>
          <Box size={13} />
          {snapshot.libraries.length} records
        </span>
      </div>
      <div className="machine-library-toolbar">
        <div className="machine-search">
          <Search size={14} />
          <input
            type="search"
            aria-label="Search libraries"
            placeholder="Search libraries and plugins…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <select
          aria-label="Library ecosystem"
          value={ecosystem}
          onChange={(event) => {
            setEcosystem(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All ecosystems</option>
          <option value="npm">npm</option>
          <option value="python">Python</option>
          <option value="plugin">Plugins</option>
        </select>
        <select
          aria-label="Library source"
          value={source}
          onChange={(event) => {
            setSource(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All sources</option>
          {snapshot.sources.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label} · {item.path}
            </option>
          ))}
        </select>
        <select
          aria-label="Library status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All evidence</option>
          <option value="installed">Installed</option>
          <option value="declared">Declared</option>
          <option value="cached">Cached</option>
        </select>
      </div>
      {!filtered.length ? (
        <EmptyState
          title={
            snapshot.libraries.length
              ? "No matching libraries"
              : "No libraries observed"
          }
          action={
            <button className="button" onClick={reset}>
              Clear library filters
            </button>
          }
        >
          {snapshot.libraries.length
            ? "Try another package name, ecosystem, source, or status."
            : "Source coverage shows which environments were checked. Add a folder to include another environment."}
        </EmptyState>
      ) : (
        <>
          <div className="machine-table-wrap">
            <table className="machine-data-table machine-library-table">
              <caption className="sr-only">Discovered libraries</caption>
              <thead>
                <tr>
                  <th scope="col">Library / plugin</th>
                  <th scope="col">Ecosystem</th>
                  <th scope="col">Version / requirement</th>
                  <th scope="col">Evidence</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((library) => (
                  <Fragment key={library.id}>
                    <tr className="machine-library-row">
                      <td data-label="Library / plugin">
                        <button
                          className="machine-library-name"
                          aria-expanded={expanded === library.id}
                          onClick={() =>
                            setExpanded(
                              expanded === library.id ? null : library.id,
                            )
                          }
                        >
                          <Box size={14} />
                          <strong>{library.name}</strong>
                          <ChevronDown size={11} />
                        </button>
                      </td>
                      <td data-label="Ecosystem">
                        <span
                          className={`machine-ecosystem ${library.ecosystem}`}
                        >
                          {
                            { python: "Python", npm: "npm", plugin: "Plugin" }[
                              library.ecosystem
                            ]
                          }
                        </span>
                      </td>
                      <td data-label="Version / requirement">
                        <span className="machine-version">
                          {library.status === "declared"
                            ? library.requestedVersion || "Unspecified"
                            : library.version || "Unavailable"}
                        </span>
                      </td>
                      <td data-label="Evidence">
                        <span className={`machine-status ${library.status}`}>
                          <span />
                          {
                            {
                              installed: "Installed",
                              declared: "Declared",
                              cached: "Cached",
                            }[library.status]
                          }
                        </span>
                      </td>
                      <td
                        data-label="Source"
                        className="machine-library-source"
                      >
                        {snapshot.sources.find(
                          (item) => item.id === library.sourceId,
                        )?.label || library.sourceId}
                      </td>
                    </tr>
                    {expanded === library.id && (
                      <tr className="machine-expanded-row">
                        <td colSpan={5}>
                          <div className="machine-library-detail">
                            <code>{library.path}</code>
                            <p>
                              {library.status === "declared"
                                ? "This is a project requirement. No installed version was established for this record."
                                : library.status === "cached"
                                  ? "Cached metadata does not establish installation, enablement, or runtime use."
                                  : "Package metadata confirms installation in this source; it does not establish runtime use."}
                            </p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="machine-pagination">
            <span>
              {offset + 1}–{Math.min(offset + pageSize, filtered.length)} of{" "}
              {filtered.length}
            </span>
            <label>
              Rows
              <select
                aria-label="Libraries per page"
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
            <div>
              <button
                className="icon-button"
                aria-label="Previous library page"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft size={16} />
              </button>
              <span>
                {currentPage} / {pages}
              </span>
              <button
                className="icon-button"
                aria-label="Next library page"
                disabled={currentPage === pages}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </>
      )}
      <p className="machine-footnote">
        <ArrowDownToLine size={12} />
        Installed, declared, and cached records are distinct. Libraries used by
        running processes are not inferred.
      </p>
    </section>
  );
}

function Sources({
  snapshot,
  busy,
  mutate,
}: {
  snapshot: MachineSnapshot;
  busy: string;
  mutate: (
    name: string,
    path: string,
    method: string,
    body?: unknown,
  ) => Promise<boolean>;
}) {
  const [path, setPath] = useState("");
  const [label, setLabel] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const added = await mutate("add", "/machine/sources", "POST", {
      path: path.trim(),
      ...(label.trim() ? { label: label.trim() } : {}),
    });
    if (added) {
      setPath("");
      setLabel("");
    }
  }
  return (
    <>
      <section>
        <div className="machine-section-title">
          <h2>Source coverage</h2>
          <span>
            {
              snapshot.sources.filter((source) => source.status === "scanned")
                .length
            }{" "}
            of {snapshot.sources.length} fully scanned
          </span>
        </div>
        <p className="machine-coverage-intro">
          Only the listed environments and bounded metadata are checked. This is
          not an exhaustive disk scan.
        </p>
        <div className="machine-source-list">
          {snapshot.sources.map((source) => (
            <article className="machine-source-row" key={source.id}>
              <FolderOpen size={17} />
              <div>
                <div className="machine-source-heading">
                  <h3>{source.label}</h3>
                  <span className={`machine-status ${source.status}`}>
                    <span />
                    {
                      {
                        scanned: "Scanned",
                        missing: "Missing",
                        error: "Error",
                        partial: "Partial",
                      }[source.status]
                    }
                  </span>
                </div>
                <code>{source.path}</code>
                {source.detail && <p>{source.detail}</p>}
              </div>
              <span className="machine-source-count">
                {source.packageCount}
                <small>records</small>
              </span>
            </article>
          ))}
        </div>
        {!snapshot.sources.length && (
          <p className="machine-empty-inline">
            No source coverage has been reported yet.
          </p>
        )}
        {snapshot.scan.issues.length > 0 && (
          <details className="machine-coverage-issues">
            <summary>
              Observation notes <span>{snapshot.scan.issues.length}</span>
            </summary>
            <ul>
              {snapshot.scan.issues.map((issue, index) => (
                <li key={index}>{issue}</li>
              ))}
            </ul>
          </details>
        )}
      </section>
      <section className="machine-custom-section">
        <div className="machine-section-title">
          <h2>Additional folders</h2>
          <span>
            {snapshot.customSources.length} / {snapshot.limits.maxCustomSources}
          </span>
        </div>
        <p className="machine-coverage-intro">
          Include another project or package environment. Removing a folder
          stops monitoring it; its contents stay in place.
        </p>
        {snapshot.customSources.length > 0 && (
          <ul className="machine-custom-list">
            {snapshot.customSources.map((source) => (
              <li key={source.id}>
                <FolderOpen size={15} />
                <div>
                  <strong>{source.label}</strong>
                  <code>{source.path}</code>
                </div>
                <button
                  className="icon-button"
                  aria-label={`Remove folder ${source.label}`}
                  disabled={!!busy}
                  onClick={() =>
                    void mutate(
                      "remove",
                      `/machine/sources/${pathId(source.id)}`,
                      "DELETE",
                    )
                  }
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form className="machine-source-form" onSubmit={submit}>
          <label>
            Folder path
            <input
              aria-label="Folder path"
              value={path}
              required
              onChange={(event) => setPath(event.target.value)}
              placeholder="/absolute/path/to/environment"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label>
            Label <span className="optional">optional</span>
            <input
              aria-label="Folder label"
              value={label}
              maxLength={80}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="A useful name"
            />
          </label>
          <button
            className="button"
            disabled={
              !!busy ||
              !path.trim() ||
              snapshot.customSources.length >= snapshot.limits.maxCustomSources
            }
          >
            <Plus size={14} />
            {busy === "add" ? "Adding…" : "Add folder"}
          </button>
        </form>
        {snapshot.customSources.length >= snapshot.limits.maxCustomSources && (
          <p className="machine-limit-note">
            The additional-folder limit has been reached. Remove a folder before
            adding another.
          </p>
        )}
      </section>
    </>
  );
}
