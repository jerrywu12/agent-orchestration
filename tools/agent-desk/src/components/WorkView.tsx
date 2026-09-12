import { useMemo, useState, type RefObject } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Filter,
  GitPullRequest,
  LayoutGrid,
  List,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { DeskState, Priority, Stage, Ticket } from "../types";
import {
  AgentAvatar,
  capitalize,
  EmptyState,
  isActive,
  isStale,
  priorities,
  PriorityIcon,
  safeUrl,
  StageIcon,
  ticketKey,
  timeAgo,
} from "./shared";

interface Props {
  state: DeskState;
  projectId: string;
  onOpen: (id: string) => void;
  onCreate: (stageId?: string) => void;
  onCreateProject: () => void;
  onUpdate: (ticket: Ticket, fields: Partial<Ticket>) => Promise<void>;
  searchRef: RefObject<HTMLInputElement | null>;
}
export function WorkView({
  state,
  projectId,
  onOpen,
  onCreate,
  onCreateProject,
  onUpdate,
  searchRef,
}: Props) {
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("");
  const [priority, setPriority] = useState("");
  const [view, setView] = useState<"list" | "board">("list");
  const [extraFilters, setExtraFilters] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [archived, setArchived] = useState(false);
  const [label, setLabel] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<string | null>(null);
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
    if (label && !ticket.labels?.includes(label)) return false;
    const needle = search.toLowerCase().trim();
    return (
      !needle ||
      `${ticket.title} ${ticketKey(ticket, state.projects)} ${ticket.description || ""} ${(ticket.labels || []).join(" ")}`
        .toLowerCase()
        .includes(needle)
    );
  });
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
    setLabel("");
    setBlocked(false);
    setArchived(false);
  }
  const activeCount = relevant.filter((ticket) =>
    isActive(ticket.execution),
  ).length;
  return (
    <>
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
            {(label || blocked || archived) && <span className="filter-dot" />}
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
      {extraFilters && (
        <div className="extra-filters">
          <Filter size={14} />
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
      ) : filtering && !filtered.length ? (
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
      ) : (
        <div className={view === "list" ? "work-list" : "work-board"}>
          {view === "list" && (
            <div className="list-columns">
              <span>Ticket</span>
              <span>Stage</span>
              <span>Priority</span>
              <span>Owner</span>
              <span>Updated</span>
            </div>
          )}
          {displayGroups.map((group) => {
            const ids = new Set(group.stages.map((stage) => stage.id));
            const tickets = filtered.filter((ticket) =>
              group.id === "unknown"
                ? !state.stages.some((stage) => stage.id === ticket.stageId)
                : ids.has(ticket.stageId),
            );
            if (filtering && !tickets.length) return null;
            const folded = collapsed.has(group.id) && view === "list";
            return (
              <section
                className={`stage-group ${view === "board" ? "board-column" : ""}`}
                key={group.id}
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
                {!folded && (
                  <div className="stage-tickets">
                    {tickets.map((ticket) => {
                      const agent = state.agents.find(
                        (item) => item.id === ticket.ownerId,
                      );
                      const stage = state.stages.find(
                        (item) => item.id === ticket.stageId,
                      );
                      const running = isActive(ticket.execution);
                      const stale = isStale(ticket.execution);
                      return view === "board" ? (
                        <article className="board-ticket" key={ticket.id}>
                          <div className="board-ticket-meta">
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
                          {ticket.blockedReason && (
                            <span className="status-chip warning">
                              <AlertTriangle size={11} />
                              Blocked
                            </span>
                          )}
                          {running && (
                            <span
                              className={`status-chip ${stale ? "warning" : "active"}`}
                            >
                              <CircleDot size={11} />
                              {stale
                                ? "Heartbeat stale"
                                : ticket.execution?.external
                                  ? "External session"
                                  : "Running"}
                              {typeof ticket.execution?.progress === "number"
                                ? ` · ${ticket.execution.progress}%`
                                : ""}
                            </span>
                          )}
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
                        >
                          <div className="ticket-main">
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
                              {ticket.blockedReason && (
                                <span
                                  className="status-chip warning"
                                  title={ticket.blockedReason}
                                >
                                  <AlertTriangle size={11} />
                                  <span>Blocked</span>
                                </span>
                              )}
                              {running && (
                                <span
                                  className={`status-chip ${stale ? "warning" : "active"}`}
                                  title={
                                    stale
                                      ? "Heartbeat is older than two minutes; ownership is retained."
                                      : ticket.execution?.summary ||
                                        "Active execution"
                                  }
                                >
                                  <CircleDot size={11} />
                                  <span>
                                    {stale
                                      ? "Stale"
                                      : ticket.execution?.external
                                        ? "External"
                                        : typeof ticket.execution?.progress ===
                                            "number"
                                          ? `${ticket.execution.progress}%`
                                          : "Running"}
                                  </span>
                                </span>
                              )}
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
                              disabled={pending === ticket.id}
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
                              disabled={pending === ticket.id}
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
                          <div className="inline-select owner-cell">
                            <AgentAvatar agent={agent} small />
                            <select
                              aria-label={`Owner for ${ticketKey(ticket, state.projects)}`}
                              disabled={pending === ticket.id}
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
                          <time
                            className="updated-cell"
                            dateTime={ticket.updatedAt}
                            title={ticket.updatedAt}
                          >
                            {timeAgo(ticket.updatedAt)}
                          </time>
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
