import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type DragEvent,
} from "react";
import {
  AlertTriangle,
  Archive,
  ChevronDown,
  ChevronRight,
  Filter,
  GitPullRequest,
  LayoutGrid,
  List,
  Plus,
  Play,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type {
  DeskState,
  Integrations,
  Priority,
  Stage,
  Ticket,
} from "../types";
import { ticketComparator, ticketSortOptions } from "../ticket-sort";
import { efforts, effortHelp } from "../effort";
import { EffortSelect } from "./EffortSelect";
import { BulkPlanningTransition } from "./BulkPlanningTransition";
import { PlanningProgress, planningIsWorking } from "./PlanningProgress";
import type { ArchiveResult, BulkRun } from "../bulk-types";
import { api, ApiError, errorMessage, pathId } from "../api";
import {
  RunProgress,
  executionNeedsInspection,
  runCounts,
  timestamp,
} from "./RunProgress";
import { ExecutionTracking } from "./ExecutionTracking";
import {
  AgentAvatar,
  capitalize,
  EmptyState,
  ErrorNotice,
  isActive,
  ExecutionStatus,
  Modal,
  priorities,
  PriorityIcon,
  safeUrl,
  StageIcon,
  ticketKey,
} from "./shared";

interface Props {
  state: DeskState;
  integrations: Integrations | null;
  boardError?: string;
  projectId: string;
  onOpen: (id: string) => void;
  onCreate: (stageId?: string) => void;
  onCreateProject: () => void;
  onUpdate: (ticket: Ticket, fields: Partial<Ticket>) => Promise<void>;
  refresh?: () => Promise<void>;
  searchRef: RefObject<HTMLInputElement | null>;
}
const lastRunKey = "agent-desk:last-bulk-run:v1";
const planningDragType = "application/x-agent-desk-planning";
interface RunRequest {
  ticketIds: string[];
  concurrency: number;
  requestId: string;
}
interface SavedRun {
  id: string;
  concurrency: number;
  ticketIds?: string[];
}
function restoreSavedRun(): SavedRun | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(lastRunKey) || "null");
    if (
      !saved ||
      typeof saved.id !== "string" ||
      saved.id.length > 200 ||
      ![1, 2, 4].includes(saved.concurrency)
    )
      return null;
    if (
      saved.ticketIds !== undefined &&
      (!Array.isArray(saved.ticketIds) ||
        !saved.ticketIds.length ||
        saved.ticketIds.length > 100 ||
        saved.ticketIds.some(
          (id: unknown) => typeof id !== "string" || !id || id.length > 300,
        ))
    )
      return null;
    return saved;
  } catch {
    return null;
  }
}
function restoringRun(saved: SavedRun): BulkRun {
  return {
    id: saved.id,
    concurrency: saved.concurrency,
    state: "running",
    results: [],
    createdAt: "",
    observedAt: "",
  };
}
function rememberRun(run: BulkRun | null) {
  try {
    if (run)
      sessionStorage.setItem(
        lastRunKey,
        JSON.stringify({ id: run.id, concurrency: run.concurrency }),
      );
    else sessionStorage.removeItem(lastRunKey);
  } catch {
    // Restricted browser storage still allows tracking in this mounted view.
  }
}
export function WorkView({
  state,
  integrations,
  boardError,
  projectId,
  onOpen,
  onCreate,
  onCreateProject,
  onUpdate,
  searchRef,
  refresh,
}: Props) {
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("");
  const [priority, setPriority] = useState("");
  const [effort, setEffort] = useState("");
  const [sort, setSort] = useState("");
  const [view, setView] = useState<"list" | "board">("list");
  const [extraFilters, setExtraFilters] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [archived, setArchived] = useState(false);
  const [label, setLabel] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [concurrency, setConcurrency] = useState(2);
  const [bulkBusy, setBulkBusy] = useState("");
  const [bulkError, setBulkError] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [planningTickets, setPlanningTickets] = useState<Ticket[] | null>(null);
  const [planningPhase, setPlanningPhase] = useState<
    "preview" | "submitting" | "finished"
  >("preview");
  const [planningKey, setPlanningKey] = useState(0);
  const planningBusy = !!planningTickets && planningPhase !== "finished";
  const [dragCount, setDragCount] = useState(0);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const planningGesture = useRef<{ tickets: Ticket[]; token: string } | null>(
    null,
  );
  const [savedRun] = useState(restoreSavedRun);
  const [run, setRun] = useState<BulkRun | null>(() =>
    savedRun ? restoringRun(savedRun) : null,
  );
  const [runMissing, setRunMissing] = useState(false);
  const [takeover, setTakeover] = useState<{
    runId: string;
    ticketId: string;
    executionId: string;
  } | null>(null);
  const [takeoverPending, setTakeoverPending] = useState(false);
  const currentRun = useRef(run);
  currentRun.current = run;
  const [clockNow, setClockNow] = useState(Date.now);
  const observation = useMemo(
    () => ({
      at: timestamp(run?.observedAt) ?? Date.now(),
      receivedAt: Date.now(),
    }),
    [run?.id, run?.observedAt],
  );
  const runNow =
    observation.at + Math.max(0, clockNow - observation.receivedAt);
  const counts = runCounts(run?.results || [], runNow);
  useEffect(() => {
    setClockNow(Date.now());
    if (run?.state !== "running") return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [run?.state]);
  const [pollError, setPollError] = useState("");
  const [pollRetry, setPollRetry] = useState(0);
  const runRequest = useRef<RunRequest | null>(
    savedRun?.ticketIds
      ? {
          requestId: savedRun.id,
          concurrency: savedRun.concurrency,
          ticketIds: savedRun.ticketIds,
        }
      : null,
  );
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const relevant = useMemo(
    () =>
      state.tickets.filter(
        (ticket) => !projectId || ticket.projectId === projectId,
      ),
    [state.tickets, projectId],
  );
  const labels = [
    ...new Set(relevant.flatMap((ticket) => ticket.labels || [])),
  ].sort();
  const filtered = relevant.filter((ticket) => {
    if (!!ticket.archived !== archived || (blocked && !ticket.blockedReason))
      return false;
    if (
      owner &&
      (owner === "unassigned" ? !!ticket.ownerId : ticket.ownerId !== owner)
    )
      return false;
    if (priority && ticket.priority !== priority) return false;
    if (effort && (effort === "unset" ? ticket.effort != null : ticket.effort !== effort)) return false;
    if (label && !ticket.labels?.includes(label)) return false;
    const needle = search.toLowerCase().trim();
    return (
      !needle ||
      `${ticket.title} ${ticketKey(ticket, state.projects)} ${ticket.description || ""} ${(ticket.labels || []).join(" ")}`
        .toLowerCase()
        .includes(needle)
    );
  });
  if (sort) filtered.sort(ticketComparator(sort, state.agents));
  const visibleIds = filtered.map((ticket) => ticket.id);
  const selectionScope = JSON.stringify([
    projectId,
    search,
    owner,
    priority,
    effort,
    label,
    blocked,
    archived,
    [...visibleIds].sort(),
  ]);
  const selectedIds = visibleIds.filter((id) => selected.has(id));
  const planningLocked =
    !!bulkBusy || !!pending || !!takeover || takeoverPending || planningBusy;
  function clearPlanningDrag() {
    planningGesture.current = null;
    setDragCount(0);
    setDropTarget(null);
  }
  useEffect(() => {
    planningGesture.current = null;
    setDragCount(0);
    setDropTarget(null);
  }, [projectId, view]);
  function openPlanning(tickets: Ticket[]) {
    if (planningLocked || archived || !tickets.length) return;
    setConfirmArchive(false);
    setPlanningPhase("preview");
    setPlanningKey((key) => key + 1);
    setPlanningTickets(structuredClone(tickets.slice(0, 100)));
  }
  function beginPlanningDrag(event: DragEvent<HTMLElement>, ticket: Ticket) {
    if (
      planningLocked ||
      ticket.archived ||
      state.stages.find((s) => s.id === ticket.stageId)?.role !== "backlog"
    ) {
      event.preventDefault();
      return;
    }
    const tickets = selected.has(ticket.id)
      ? filtered.filter((t) => selected.has(t.id)).slice(0, 100)
      : [ticket];
    const token = crypto.randomUUID();
    planningGesture.current = { tickets: structuredClone(tickets), token };
    event.dataTransfer.setData(planningDragType, token);
    event.dataTransfer.effectAllowed = "move";
    setDragCount(tickets.length);
  }
  function acceptsPlanningDrag(event: DragEvent<HTMLElement>) {
    return (
      !planningLocked &&
      !archived &&
      !!planningGesture.current &&
      event.dataTransfer.types.includes(planningDragType)
    );
  }
  function dropPlanning(event: DragEvent<HTMLElement>) {
    if (
      !acceptsPlanningDrag(event) ||
      event.dataTransfer.getData(planningDragType) !==
        planningGesture.current?.token
    )
      return;
    event.preventDefault();
    const tickets = planningGesture.current!.tickets;
    clearPlanningDrag();
    openPlanning(tickets);
  }
  useEffect(() => {
    const visible = new Set(visibleIds);
    setSelected(
      (current) => new Set([...current].filter((id) => visible.has(id))),
    );
    setConfirmArchive(false);
  }, [selectionScope]);
  useEffect(() => {
    if (!run || run.state !== "running" || bulkBusy === "run") return;
    let cancelled = false;
    let timer: number | undefined;
    const runId = run.id;
    async function poll() {
      try {
        const next = await api<BulkRun>(`/runs/${pathId(runId)}`);
        if (cancelled) return;
        rememberRun(next);
        runRequest.current = null;
        setRun(next);
        setRunMissing(false);
        setBulkError("");
        setPollError("");
        if (next.state === "running")
          timer = window.setTimeout(() => void poll(), 2000);
        else await refresh?.();
      } catch (failure) {
        if (!cancelled) {
          setRunMissing(failure instanceof ApiError && failure.status === 404);
          setPollError(errorMessage(failure));
        }
      }
    }
    timer = window.setTimeout(
      () => void poll(),
      pollRetry || !run.results.length ? 0 : 2000,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [run?.id, run?.state, pollRetry, refresh, bulkBusy]);
  const runActive = run?.state === "running";
  function selectTicket(id: string, checked: boolean) {
    if (planningLocked) return;
    setSelected((current) => {
      const next = new Set(current);
      if (checked && next.size < 100) next.add(id);
      else if (!checked) next.delete(id);
      return next;
    });
    setConfirmArchive(false);
  }
  async function runSelected(
    retryOriginal = false,
    recoveredTicketId?: string,
  ) {
    const recovered = recoveredTicketId
      ? run?.results.find(
          (row) =>
            row.ticketId === recoveredTicketId &&
            row.status === "claim_released",
        )
      : undefined;
    if (recoveredTicketId && !recovered) return;
    if (
      bulkBusy ||
      planningBusy ||
      takeoverPending ||
      (retryOriginal
        ? !runMissing || !runRequest.current
        : runActive ||
          !!runRequest.current ||
          (!recoveredTicketId && !selectedIds.length))
    )
      return;
    const request =
      retryOriginal && runRequest.current
        ? runRequest.current
        : {
            ticketIds: recoveredTicketId ? [recoveredTicketId] : selectedIds,
            concurrency,
            requestId: crypto.randomUUID(),
          };
    runRequest.current = request;
    try {
      sessionStorage.setItem(
        lastRunKey,
        JSON.stringify({
          id: request.requestId,
          concurrency: request.concurrency,
          ticketIds: request.ticketIds,
        }),
      );
    } catch {
      runRequest.current = null;
      setBulkError(
        "The run was not sent because browser session storage is unavailable. Enable session storage before starting a batch.",
      );
      return;
    }
    setRun(
      restoringRun({ id: request.requestId, concurrency: request.concurrency }),
    );
    setRunMissing(false);
    setBulkBusy("run");
    setBulkError("");
    setPollError("");
    try {
      const next = await api<BulkRun>("/runs", "POST", request);
      if (!mounted.current || restoreSavedRun()?.id !== request.requestId)
        return;
      rememberRun(next);
      setRun(next);
      runRequest.current = null;
      await refresh?.();
    } catch (failure) {
      if (mounted.current) setBulkError(errorMessage(failure));
    } finally {
      if (mounted.current) setBulkBusy("");
    }
  }
  async function archiveSelected() {
    if (bulkBusy || planningBusy || !confirmArchive || !selectedIds.length)
      return;
    setBulkBusy("archive");
    setBulkError("");
    try {
      const result = await api<{ results: ArchiveResult[] }>(
        "/tickets/bulk-archive",
        "POST",
        { ticketIds: selectedIds },
      );
      if (!mounted.current) return;
      const failures = result.results.filter(
        (item) => item.status !== "archived",
      );
      setBulkError(
        failures
          .map((item) => {
            const ticket = state.tickets.find(
              (ticket) => ticket.id === item.ticketId,
            );
            return `${ticket ? ticketKey(ticket, state.projects) : item.ticketId}: ${item.message}`;
          })
          .join(" · "),
      );
      setSelected((current) => {
        const next = new Set(current);
        result.results
          .filter((item) => item.status === "archived")
          .forEach((item) => next.delete(item.ticketId));
        return next;
      });
      setConfirmArchive(false);
      await refresh?.();
    } catch (failure) {
      if (mounted.current) setBulkError(errorMessage(failure));
    } finally {
      if (mounted.current) setBulkBusy("");
    }
  }
  async function afterTakeover(target: {
    runId: string;
    ticketId: string;
    executionId: string;
  }) {
    const stillCurrent = () =>
      mounted.current &&
      currentRun.current?.id === target.runId &&
      restoreSavedRun()?.id === target.runId;
    if (!stillCurrent()) return;
    setTakeoverPending(false);
    setTakeover(null);
    setRun((current) =>
      current?.id === target.runId
        ? {
            ...current,
            results: current.results.map((row) =>
              row.ticketId === target.ticketId &&
              row.executionId === target.executionId
                ? {
                    ...row,
                    status: "claim_released",
                    message:
                      "Claim released; saved work retained. Run Agent to start this ticket.",
                  }
                : row,
            ),
          }
        : current,
    );
    try {
      const next = await api<BulkRun>(`/runs/${pathId(target.runId)}`);
      if (!stillCurrent()) return;
      rememberRun(next);
      setRun(next);
    } catch (failure) {
      if (stillCurrent())
        setBulkError(
          `The claim was released, but run results could not refresh. ${errorMessage(failure)}`,
        );
    }
  }
  const groups = useMemo(() => {
    const result = new Map<
      string,
      { id: string; name: string; stage: Stage; stages: Stage[] }
    >();
    state.stages
      .filter((stage) => !projectId || stage.projectId === projectId)
      .sort((a, b) => a.position - b.position)
      .forEach((stage) => {
        const id = projectId ? stage.id : `${stage.role}:${stage.name}`;
        const group = result.get(id);
        if (group) group.stages.push(stage);
        else result.set(id, { id, name: stage.name, stage, stages: [stage] });
      });
    return [...result.values()];
  }, [state.stages, projectId]);
  const filtering = !!(
    search ||
    owner ||
    priority ||
    effort ||
    label ||
    blocked ||
    archived
  );
  const hasUnknown = filtered.some(
    (ticket) => !state.stages.some((stage) => stage.id === ticket.stageId),
  );
  const displayGroups = hasUnknown
    ? [
        ...groups,
        { id: "unknown", name: "Unknown stage", stage: undefined, stages: [] },
      ]
    : groups;
  async function update(ticket: Ticket, fields: Partial<Ticket>) {
    if (planningLocked) return;
    setPending(ticket.id);
    try {
      await onUpdate(ticket, fields);
    } finally {
      setPending(null);
    }
  }
  function clearFilters() {
    setSearch("");
    setOwner("");
    setPriority("");
    setEffort("");
    setLabel("");
    setBlocked(false);
    setArchived(false);
  }
  const activeCount = relevant.filter((ticket) =>
    isActive(ticket.execution),
  ).length;
  return (
    <>
      {takeover && (
        <Modal
          title={`Take over ${
            state.tickets.find((ticket) => ticket.id === takeover.ticketId)
              ? ticketKey(
                  state.tickets.find(
                    (ticket) => ticket.id === takeover.ticketId,
                  )!,
                  state.projects,
                )
              : takeover.ticketId
          }`}
          onClose={() => {
            if (!takeoverPending) setTakeover(null);
          }}
        >
          <div className="takeover-dialog-body">
            <ExecutionTracking
              key={`${takeover.runId}:${takeover.executionId}`}
              ticketId={takeover.ticketId}
              executionId={takeover.executionId}
              expectedExecutionId={takeover.executionId}
              autoConfirm
              disabled={!!bulkBusy}
              refresh={refresh || (async () => {})}
              onPendingChange={setTakeoverPending}
              onReleased={() => afterTakeover(takeover)}
            />
          </div>
        </Modal>
      )}
      <div className="work-heading">
        <div>
          <div className="page-kicker">
            WORKSPACE /{" "}
            {projectId
              ? state.projects.find((item) => item.id === projectId)?.key
              : "OVERVIEW"}
          </div>
          <h1>
            {projectId
              ? state.projects.find((item) => item.id === projectId)?.name
              : "All work"}
            <span className="heading-count">
              {relevant.filter((ticket) => !ticket.archived).length}
            </span>
          </h1>
          <p>Every project. Clear ownership. Progress you can follow.</p>
        </div>
        <button
          className="button primary"
          onClick={() =>
            state.projects.length ? onCreate() : onCreateProject()
          }
        >
          <Plus size={16} />
          {state.projects.length ? "New ticket" : "New project"}
          <kbd>N</kbd>
        </button>
      </div>
      <div className="work-context">
        <span>
          <span className={`live-dot ${activeCount ? "" : "quiet"}`} />
          {activeCount
            ? `${activeCount} agent ${activeCount === 1 ? "session" : "sessions"} reserved`
            : "No reserved agent sessions"}
        </span>
        <span>
          {
            relevant.filter(
              (ticket) => ticket.blockedReason && !ticket.archived,
            ).length
          }{" "}
          blocked
        </span>
        <span>
          {state.sync.reduce(
            (sum, item) =>
              sum +
              (!projectId || item.projectId === projectId
                ? item.pending || 0
                : 0),
            0,
          )}{" "}
          pending sync
        </span>
      </div>
      <div className="work-toolbar">
        <div className="search-field">
          <Search size={15} />
          <input
            ref={searchRef}
            aria-label="Search tickets"
            placeholder="Search tickets…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <kbd>/</kbd>
        </div>
        <div className="toolbar-filters">
          <select
            aria-label="Filter by agent"
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
          >
            <option value="">All agents</option>
            <option value="unassigned">Unassigned</option>
            {state.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by priority"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          >
            <option value="">Any priority</option>
            {priorities.map((value) => (
              <option key={value} value={value}>
                {capitalize(value)}
              </option>
            ))}
          </select>
          <button
            className={`button subtle ${extraFilters ? "selected" : ""}`}
            onClick={() => setExtraFilters(!extraFilters)}
            aria-expanded={extraFilters}
          >
            <SlidersHorizontal size={14} />
            <span className="desktop-label">Filters</span>
            {(label || effort || blocked || archived) && <span className="filter-dot" />}
          </button>
        </div>
        <div className="view-toggle" aria-label="View layout">
          <button
            aria-label="List view"
            aria-pressed={view === "list"}
            className={view === "list" ? "selected" : ""}
            onClick={() => setView("list")}
          >
            <List size={16} />
          </button>
          <button
            aria-label="Board view"
            aria-pressed={view === "board"}
            className={view === "board" ? "selected" : ""}
            onClick={() => setView("board")}
          >
            <LayoutGrid size={15} />
          </button>
        </div>
      </div>
      {sort && (
        <div className="active-sort" aria-label="Active sort">
          <span>{ticketSortOptions.find(([value]) => value === sort)?.[1]}</span>
          <button className="text-button" onClick={() => setSort("")}>
            <X size={13} />Clear sort
          </button>
        </div>
      )}
      {extraFilters && (
        <div className="extra-filters">
          <Filter size={14} />
          <select aria-label="Filter by effort" title={effortHelp} value={effort} onChange={event => setEffort(event.target.value)}>
            <option value="">Any effort</option>
            <option value="unset">Unset</option>
            {efforts.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
          <select aria-label="Sort tickets" value={sort} onChange={event => setSort(event.target.value)}>
            <option value="">Default order</option>
            {ticketSortOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select
            aria-label="Filter by label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          >
            <option value="">All labels</option>
            {labels.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={blocked}
              onChange={(event) => setBlocked(event.target.checked)}
            />
            Blocked only
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={archived}
              onChange={(event) => setArchived(event.target.checked)}
            />
            Archived
          </label>
          {filtering && (
            <button className="text-button" onClick={clearFilters}>
              <X size={13} />
              Clear filters
            </button>
          )}
        </div>
      )}
      {!!state.projects.length && (
        <div className="bulk-actions" aria-label="Bulk ticket actions">
          <label className="checkbox-label">
            <input
              type="checkbox"
              aria-label="Select all visible tickets"
              checked={
                !!visibleIds.length &&
                selectedIds.length === Math.min(visibleIds.length, 100)
              }
              disabled={!visibleIds.length || planningLocked}
              ref={(node) => {
                if (node)
                  node.indeterminate =
                    selectedIds.length > 0 &&
                    selectedIds.length < Math.min(visibleIds.length, 100);
              }}
              onChange={(event) => {
                setSelected(
                  new Set(event.target.checked ? visibleIds.slice(0, 100) : []),
                );
                setConfirmArchive(false);
              }}
            />
            Select visible
          </label>
          <span className="bulk-selection-count">
            {selectedIds.length} selected
          </span>
          {selectedIds.length > 0 && (
            <button
              className="text-button"
              disabled={planningLocked}
              onClick={() => {
                setSelected(new Set());
                setConfirmArchive(false);
              }}
            >
              Clear selection
            </button>
          )}
          <label className="bulk-concurrency">
            Agent limit
            <select
              aria-label="Bulk run concurrency"
              value={concurrency}
              disabled={!!bulkBusy || planningBusy || runActive}
              onChange={(event) => {
                setConcurrency(Number(event.target.value));
              }}
            >
              {[1, 2, 4].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button primary small-button"
            disabled={
              !selectedIds.length || !!bulkBusy || planningBusy || runActive
            }
            onClick={() => void runSelected()}
          >
            <Play size={13} />
            {bulkBusy === "run" ? "Submitting…" : "Run Agent"}
          </button>
          <button
            className="button small-button"
            disabled={!selectedIds.length || planningLocked || archived}
            onClick={() =>
              openPlanning(filtered.filter((ticket) => selected.has(ticket.id)))
            }
          >
            Move to Planning
          </button>
          <button
            className="button small-button"
            aria-label="Archive selected tickets"
            disabled={
              !selectedIds.length || !!bulkBusy || planningBusy || archived
            }
            onClick={() => setConfirmArchive(true)}
          >
            <Archive size={13} />
            Archive
          </button>
          {visibleIds.length > 100 && (
            <p className="bulk-action-hint">
              Select up to 100 tickets per operation. Select visible chooses the
              first 100 matching tickets.
            </p>
          )}
          {confirmArchive && (
            <div className="bulk-archive-confirmation">
              <p>
                Archive {selectedIds.length} selected tickets? Active
                reservations will be retained and reported individually.
              </p>
              <button
                className="button danger small-button"
                disabled={!!bulkBusy}
                onClick={() => void archiveSelected()}
              >
                {bulkBusy === "archive"
                  ? "Archiving…"
                  : `Archive ${selectedIds.length} ${selectedIds.length === 1 ? "ticket" : "tickets"}`}
              </button>
              <button
                className="button small-button"
                disabled={!!bulkBusy}
                onClick={() => setConfirmArchive(false)}
              >
                Cancel archive
              </button>
            </div>
          )}
        </div>
      )}
      {bulkError && (
        <div className="bulk-feedback">
          <ErrorNotice>{bulkError}</ErrorNotice>
        </div>
      )}
      {planningTickets ? (
        <BulkPlanningTransition
          key={planningKey}
          tickets={planningTickets}
          state={state}
          integrations={integrations}
          boardError={boardError}
          projectId={projectId}
          onPhaseChange={setPlanningPhase}
          onOpen={onOpen}
          onClose={() => setPlanningTickets(null)}
          onComplete={async (admittedIds) => {
            const admitted = new Set(admittedIds);
            setSelected(
              (current) =>
                new Set([...current].filter((id) => !admitted.has(id))),
            );
            await refresh?.();
          }}
        />
      ) : (
        <PlanningProgress
          state={state}
          projectId={projectId}
          error={boardError}
          onOpen={onOpen}
        />
      )}
      {run && (
        <section className="bulk-results" aria-label="Bulk run results">
          <div className="bulk-results-heading">
            <h2>
              {!run.results.length
                ? bulkBusy === "run"
                  ? "Submitting run request…"
                  : "Restoring agent run"
                : counts.working > 0
                  ? "Agent run in progress"
                  : counts.attention > 0
                    ? "Action required"
                    : counts.queued > 0
                      ? "Waiting to start"
                      : "Agent run finished"}
            </h2>
            <span>
              Agent limit: {run.concurrency}
              {!!run.results.length &&
                ` · ${run.results.length} ${run.results.length === 1 ? "ticket" : "tickets"}`}
            </span>
            {run.state === "complete" && (
              <button
                className="text-button"
                disabled={takeoverPending}
                onClick={() => {
                  rememberRun(null);
                  setRun(null);
                  setPollError("");
                }}
              >
                {counts.attention > 0
                  ? "Dismiss results"
                  : "Dismiss finished run"}
              </button>
            )}
          </div>
          {!!run.results.length && (
            <div className="run-overview" aria-label="Run overview">
              <span>{counts.queued} queued</span>
              <span>{counts.working} working</span>
              <span>{counts.attention} needs attention</span>
              <span>{counts.finished} finished</span>
            </div>
          )}
          {run.state === "running" && bulkBusy !== "run" && (
            <p
              className={`run-update-status ${pollError ? "run-update-paused" : ""}`}
              role="status"
            >
              {pollError
                ? "Tracking paused · showing last reported evidence"
                : "Updates every 2 seconds"}
            </p>
          )}
          {!run.results.length && !pollError && (
            <p role="status">
              {bulkBusy === "run"
                ? "Waiting for the selected tickets to be accepted…"
                : "Loading the recorded run and its ticket results…"}
            </p>
          )}
          {pollError && (
            <>
              <ErrorNotice>{pollError}</ErrorNotice>
              <p>
                {runMissing
                  ? "No accepted run was found for this request ID."
                  : "Tracking is paused. The run may still be active; retry tracking before starting more work."}
              </p>
              {runMissing && runRequest.current && (
                <>
                  <p>
                    Original selection:{" "}
                    {runRequest.current.ticketIds
                      .map((id) => {
                        const ticket = state.tickets.find(
                          (item) => item.id === id,
                        );
                        return ticket ? ticketKey(ticket, state.projects) : id;
                      })
                      .join(", ")}
                    . Agent limit: {runRequest.current.concurrency}.
                  </p>
                  <button
                    className="button small-button"
                    disabled={!!bulkBusy}
                    onClick={() => void runSelected(true)}
                  >
                    Retry same run request
                  </button>
                </>
              )}
              {runMissing && (
                <button
                  className="button small-button"
                  disabled={!!bulkBusy}
                  onClick={() => {
                    rememberRun(null);
                    runRequest.current = null;
                    setRun(null);
                    setRunMissing(false);
                    setPollError("");
                    setBulkError("");
                  }}
                >
                  Discard unaccepted request
                </button>
              )}
              <button
                className="button small-button"
                onClick={() => {
                  setPollError("");
                  setPollRetry((value) => value + 1);
                }}
              >
                Retry run tracking
              </button>
            </>
          )}
          <ul>
            {run.results.map((result) => {
              const ticket = state.tickets.find(
                (item) => item.id === result.ticketId,
              );
              const key = ticket
                ? ticketKey(ticket, state.projects)
                : result.ticketId;
              const recoveryState = !ticket
                ? "unknown"
                : isActive(ticket.execution) &&
                    ticket.execution?.id !== result.executionId
                  ? "reserved"
                  : ticket.archived ||
                      state.stages.find((stage) => stage.id === ticket.stageId)
                        ?.role === "done"
                    ? "closed"
                    : ticket.execution &&
                        ticket.execution.id !== result.executionId
                      ? "ended"
                      : "idle";
              return (
                <li key={result.ticketId}>
                  <button
                    className="text-button"
                    onClick={() => onOpen(result.ticketId)}
                    aria-label={
                      result.status === "needs_takeover"
                        ? `Inspect takeover for ${key}`
                        : `Open ticket ${key}`
                    }
                  >
                    {key}
                    {result.status === "needs_takeover"
                      ? " · Inspect takeover"
                      : ""}
                  </button>
                  <span
                    className={`status-chip ${["failed", "needs_takeover"].includes(result.status) || executionNeedsInspection(result) ? "warning" : ""}`}
                  >
                    {executionNeedsInspection(result)
                      ? `${result.telemetry?.state} session`
                      : result.status.replaceAll("_", " ")}
                  </span>
                  {result.status === "needs_takeover" && (
                    <button
                      className="button small-button"
                      aria-label={`Take over ${key}`}
                      disabled={
                        !result.executionId || !!bulkBusy || takeoverPending
                      }
                      title={
                        !result.executionId
                          ? "Refresh this run to obtain its execution reference."
                          : undefined
                      }
                      onClick={() =>
                        result.executionId &&
                        setTakeover({
                          runId: run.id,
                          ticketId: result.ticketId,
                          executionId: result.executionId,
                        })
                      }
                    >
                      Take over
                    </button>
                  )}
                  {result.status === "claim_released" && (
                    <button
                      className="button primary small-button"
                      aria-label={`Run Agent for ${key}`}
                      disabled={
                        !!bulkBusy ||
                        takeoverPending ||
                        runActive ||
                        recoveryState !== "idle"
                      }
                      title={
                        runActive
                          ? "Wait for the remaining batch executions to finish."
                          : undefined
                      }
                      onClick={() => void runSelected(false, result.ticketId)}
                    >
                      <Play size={13} />
                      Run Agent
                    </button>
                  )}
                  {!["needs_takeover", "claim_released"].includes(
                    result.status,
                  ) && <p>{result.message}</p>}
                  {result.status === "awaiting_review" && (
                    <p className="review-activity-note">
                      {!ticket
                        ? "Current ticket status is unavailable; review is unverified"
                        : state.stages.find(
                              (stage) => stage.id === ticket.stageId,
                            )?.role === "done"
                          ? "Ticket is Done"
                          : isActive(ticket.execution)
                            ? ticket.execution?.id !== result.executionId
                              ? "Another run is active; this result's review is unverified"
                              : "An agent still owns this execution; review is unverified"
                            : "No agent running; review does not start automatically"}
                    </p>
                  )}
                  <RunProgress
                    result={result}
                    ticketKey={key}
                    now={runNow}
                    paused={!!pollError}
                    batchCreatedAt={run.createdAt}
                    recoveryState={recoveryState}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {!state.projects.length ? (
        <EmptyState
          title="A fresh workspace, ready for your work"
          action={
            <button className="button primary" onClick={onCreateProject}>
              <Plus size={15} />
              Create your first project
            </button>
          }
        >
          Create a project, add tickets, and give each agent a clear place to
          contribute.
        </EmptyState>
      ) : (
        <div className={view === "list" ? "work-list" : "work-board"}>
          {filtering && !filtered.length && (
            <EmptyState
              title="No tickets match these filters"
              action={
                <button className="button" onClick={clearFilters}>
                  Clear filters
                </button>
              }
            >
              Try another search, agent, or priority to find your work.
            </EmptyState>
          )}
          {view === "list" && (
            <div className="list-columns">
              <span>Ticket</span>
              <span>Stage</span>
              <span>Priority</span>
              <span>Effort</span>
              <span>Owner</span>
              <span>Stage changed</span>
            </div>
          )}
          {displayGroups.map((group) => {
            const ids = new Set(group.stages.map((stage) => stage.id));
            const tickets = filtered.filter((ticket) =>
              group.id === "unknown"
                ? !state.stages.some((stage) => stage.id === ticket.stageId)
                : ids.has(ticket.stageId),
            );
            const planning = group.stage?.role === "planning";
            if (filtering && !tickets.length && !planning) return null;
            const folded = collapsed.has(group.id) && view === "list";
            return (
              <section
                className={`stage-group ${view === "board" ? "board-column" : ""} ${planning ? "planning-drop-target" : ""} ${dropTarget === group.id ? "planning-drop-active" : ""}`}
                key={group.id}
                aria-label={planning ? "Planning tickets" : undefined}
                onDragOver={
                  planning
                    ? (event) => {
                        if (acceptsPlanningDrag(event)) {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                          setDropTarget(group.id);
                        }
                      }
                    : undefined
                }
                onDragLeave={
                  planning
                    ? (event) => {
                        if (
                          !(event.relatedTarget instanceof Node) ||
                          !event.currentTarget.contains(event.relatedTarget)
                        )
                          setDropTarget(null);
                      }
                    : undefined
                }
                onDrop={planning ? dropPlanning : undefined}
              >
                <div className="stage-heading">
                  <button
                    className="stage-toggle"
                    onClick={() =>
                      setCollapsed((current) => {
                        const next = new Set(current);
                        if (next.has(group.id)) next.delete(group.id);
                        else next.add(group.id);
                        return next;
                      })
                    }
                    aria-expanded={!folded}
                    disabled={view === "board"}
                  >
                    {view === "list" &&
                      (folded ? (
                        <ChevronRight size={13} />
                      ) : (
                        <ChevronDown size={13} />
                      ))}
                    <StageIcon stage={group.stage} />
                    <h2>{group.name}</h2>
                    <span className="count">{tickets.length}</span>
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Add ticket to ${group.name}`}
                    onClick={() =>
                      onCreate(projectId ? group.stage?.id : undefined)
                    }
                  >
                    <Plus size={15} />
                  </button>
                </div>
                {planning && dragCount > 0 && (
                  <p className="planning-drop-hint" role="status">
                    Drop {dragCount} {dragCount === 1 ? "ticket" : "tickets"} to
                    review Planning
                  </p>
                )}
                {!folded && (
                  <div className="stage-tickets">
                    {tickets.map((ticket) => {
                      const agent = state.agents.find(
                        (item) => item.id === ticket.ownerId,
                      );
                      const stage = state.stages.find(
                        (item) => item.id === ticket.stageId,
                      );
                      return view === "board" ? (
                        <article
                          className="board-ticket"
                          key={ticket.id}
                          aria-label={`${ticketKey(ticket, state.projects)} ${ticket.title}`}
                          draggable={
                            !planningLocked &&
                            !ticket.archived &&
                            stage?.role === "backlog"
                          }
                          onDragStart={(event) =>
                            beginPlanningDrag(event, ticket)
                          }
                          onDragEnd={clearPlanningDrag}
                        >
                          <div className="board-ticket-meta">
                            <input
                              className="bulk-ticket-checkbox"
                              type="checkbox"
                              aria-label={`Select ticket ${ticketKey(ticket, state.projects)}`}
                              checked={selected.has(ticket.id)}
                              disabled={
                                planningLocked ||
                                (!selected.has(ticket.id) &&
                                  selectedIds.length >= 100)
                              }
                              onChange={(event) =>
                                selectTicket(ticket.id, event.target.checked)
                              }
                            />
                            <span
                              className="ticket-id"
                              title={ticketKey(ticket, state.projects)}
                            >
                              {ticketKey(ticket, state.projects)}
                            </span>
                            <PriorityIcon priority={ticket.priority} />
                          </div>
                          <button
                            className="ticket-title"
                            onClick={() => onOpen(ticket.id)}
                          >
                            {ticket.title}
                          </button>
                          {ticket.resumeReason && (
                            <span
                              className="status-chip warning"
                              title={ticket.resumeReason}
                            >
                              Resume needed
                            </span>
                          )}
                          {ticket.blockedReason && (
                            <span className="status-chip warning">
                              <AlertTriangle size={11} />
                              {planningIsWorking(ticket)
                                ? "Resolving blockers"
                                : "Blocked"}
                            </span>
                          )}
                          <ExecutionStatus execution={ticket.execution} />
                          <span className="effort-value" title={effortHelp}>Effort: {ticket.effort ?? "Unset"}</span>
                          <div className="board-ticket-footer">
                            <span className="label-list">
                              {ticket.labels?.slice(0, 2).map((value) => (
                                <span className="label" key={value}>
                                  {value}
                                </span>
                              ))}
                            </span>
                            <span title={agent?.name || "Unassigned"}>
                              <AgentAvatar agent={agent} small />
                            </span>
                          </div>
                        </article>
                      ) : (
                        <article
                          className="ticket-row"
                          key={ticket.id}
                          aria-label={`${ticketKey(ticket, state.projects)} ${ticket.title}`}
                          draggable={
                            !planningLocked &&
                            !ticket.archived &&
                            stage?.role === "backlog"
                          }
                          onDragStart={(event) =>
                            beginPlanningDrag(event, ticket)
                          }
                          onDragEnd={clearPlanningDrag}
                        >
                          <div className="ticket-main">
                            <input
                              className="bulk-ticket-checkbox"
                              type="checkbox"
                              aria-label={`Select ticket ${ticketKey(ticket, state.projects)}`}
                              checked={selected.has(ticket.id)}
                              disabled={
                                planningLocked ||
                                (!selected.has(ticket.id) &&
                                  selectedIds.length >= 100)
                              }
                              onChange={(event) =>
                                selectTicket(ticket.id, event.target.checked)
                              }
                            />
                            <span
                              className="ticket-id"
                              title={ticketKey(ticket, state.projects)}
                            >
                              {ticketKey(ticket, state.projects)}
                            </span>
                            <button
                              className="ticket-title"
                              onClick={() => onOpen(ticket.id)}
                            >
                              {ticket.title}
                            </button>
                            <span className="ticket-indicators">
                              {ticket.launchIntent &&
                                ticket.launchIntent.status !== "started" && (
                                  <span
                                    className="status-chip warning"
                                    title={
                                      ticket.launchIntent.reason ||
                                      "Waiting for agent capacity"
                                    }
                                  >
                                    {ticket.launchIntent.status === "queued"
                                      ? "Queued"
                                      : ticket.launchIntent.status === "failed"
                                        ? "Launch failed"
                                        : "Launch status unavailable"}
                                  </span>
                                )}
                              {ticket.resumeReason && (
                                <span
                                  className="status-chip warning"
                                  title={ticket.resumeReason}
                                >
                                  Resume needed
                                </span>
                              )}
                              {ticket.blockedReason && (
                                <span
                                  className="status-chip warning"
                                  title={ticket.blockedReason}
                                >
                                  <AlertTriangle size={11} />
                                  <span>
                                    {planningIsWorking(ticket)
                                      ? "Resolving blockers"
                                      : "Blocked"}
                                  </span>
                                </span>
                              )}
                              <ExecutionStatus execution={ticket.execution} />
                              {safeUrl(ticket.execution?.prUrl) && (
                                <a
                                  href={safeUrl(ticket.execution?.prUrl)}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="Open pull request"
                                  aria-label={`Open pull request for ${ticketKey(ticket, state.projects)}`}
                                >
                                  <GitPullRequest size={14} />
                                </a>
                              )}
                              {ticket.labels?.slice(0, 1).map((value) => (
                                <span className="label" key={value}>
                                  {value}
                                </span>
                              ))}
                            </span>
                          </div>
                          <div className="inline-select stage-cell">
                            <StageIcon stage={stage} />
                            <select
                              aria-label={`Stage for ${ticketKey(ticket, state.projects)}`}
                              disabled={
                                pending === ticket.id ||
                                planningBusy ||
                                !!bulkBusy
                              }
                              value={ticket.stageId}
                              onChange={(event) =>
                                void update(ticket, {
                                  stageId: event.target.value,
                                })
                              }
                            >
                              {state.stages
                                .filter(
                                  (item) => item.projectId === ticket.projectId,
                                )
                                .sort((a, b) => a.position - b.position)
                                .map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.name}
                                  </option>
                                ))}
                            </select>
                          </div>
                          <div className="inline-select priority-cell">
                            <PriorityIcon priority={ticket.priority} />
                            <select
                              aria-label={`Priority for ${ticketKey(ticket, state.projects)}`}
                              disabled={
                                pending === ticket.id ||
                                planningBusy ||
                                !!bulkBusy
                              }
                              value={ticket.priority || "none"}
                              onChange={(event) =>
                                void update(ticket, {
                                  priority: event.target.value as Priority,
                                })
                              }
                            >
                              {priorities.map((value) => (
                                <option key={value}>{value}</option>
                              ))}
                            </select>
                          </div>
                          <div className="inline-select effort-cell">
                            <EffortSelect value={ticket.effort} label={`Effort for ${ticketKey(ticket, state.projects)}`}
                              disabled={planningLocked} onChange={value => void update(ticket, { effort: value })} />
                          </div>
                          <div className="inline-select owner-cell">
                            <AgentAvatar agent={agent} small />
                            <select
                              aria-label={`Owner for ${ticketKey(ticket, state.projects)}`}
                              disabled={
                                pending === ticket.id ||
                                planningBusy ||
                                !!bulkBusy
                              }
                              value={ticket.ownerId || ""}
                              onChange={(event) =>
                                void update(ticket, {
                                  ownerId: event.target.value || null,
                                })
                              }
                            >
                              <option value="">Unassigned</option>
                              {state.agents.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <span className="updated-cell">
                            {ticket.stageChangedAt ? (
                              <time
                                dateTime={ticket.stageChangedAt}
                                title={ticket.stageChangedAt}
                              >
                                {new Date(
                                  ticket.stageChangedAt,
                                ).toLocaleString()}
                              </time>
                            ) : (
                              "Unknown"
                            )}
                          </span>
                        </article>
                      );
                    })}
                    {!tickets.length && (
                      <button
                        className="stage-empty"
                        onClick={() =>
                          onCreate(projectId ? group.stage?.id : undefined)
                        }
                      >
                        <Plus size={13} />
                        Add the first ticket
                      </button>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      {!!state.projects.length && (
        <div className="list-footer">
          <span>
            {filtered.length} {filtered.length === 1 ? "ticket" : "tickets"}
            {filtering ? " matching filters" : " in this view"}
          </span>
          <span>
            <kbd>N</kbd> new ticket <kbd>/</kbd> search
          </span>
        </div>
      )}
    </>
  );
}
