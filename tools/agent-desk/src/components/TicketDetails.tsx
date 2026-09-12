import { useEffect, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowRightLeft,
  Check,
  Clock3,
  ExternalLink,
  GitBranch,
  Github,
  GitPullRequest,
  MessageSquare,
  Play,
  RefreshCw,
  Save,
  Square,
} from "lucide-react";
import { api, ApiError, errorMessage, pathId } from "../api";
import type { DeskState, Integrations, Ticket, TicketDraft } from "../types";
import { ActivityFeed } from "./ActivityFeed";
import { ReconcileSessions } from "./ReconcileSessions";
import {
  AgentAvatar,
  capitalize,
  ErrorNotice,
  isActive,
  isStale,
  Modal,
  priorities,
  safeUrl,
  ticketKey,
  timeAgo,
} from "./shared";

function draftFrom(ticket: Ticket): TicketDraft {
  return {
    title: ticket.title,
    description: ticket.description || "",
    stageId: ticket.stageId,
    ownerId: ticket.ownerId || null,
    priority: ticket.priority || "none",
    labels: ticket.labels || [],
    parentId: ticket.parentId || null,
    dependsOn: ticket.dependsOn || [],
    blockedReason: ticket.blockedReason || "",
  };
}
export function TicketDetails({
  ticket,
  state,
  integrations,
  onClose,
  refresh,
  onOpen,
}: {
  ticket: Ticket;
  state: DeskState;
  integrations: Integrations | null;
  onClose: () => void;
  refresh: () => Promise<void>;
  onOpen: (id: string) => void;
}) {
  const [draft, setDraft] = useState(() => draftFrom(ticket));
  const [version, setVersion] = useState(ticket.version);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [comment, setComment] = useState("");
  const [handoff, setHandoff] = useState(false);
  const [handoffOwner, setHandoffOwner] = useState("");
  const [handoffSummary, setHandoffSummary] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  useEffect(() => {
    if (!dirty && ticket.version >= version) {
      setDraft(draftFrom(ticket));
      setVersion(ticket.version);
    }
  }, [ticket.version, dirty]);
  function change<K extends keyof TicketDraft>(key: K, value: TicketDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setNotice("");
  }
  function close() {
    if (busy) return;
    if (dirty || comment.trim()) setConfirmDiscard(true);
    else onClose();
  }
  async function perform(
    key: string,
    callback: () => Promise<unknown>,
    success: string,
  ) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await callback();
      await refresh();
      setNotice(success);
    } catch (failure) {
      setError(errorMessage(failure));
      if (
        failure instanceof ApiError &&
        failure.status === 409 &&
        key === "save"
      )
        setConflict(true);
    } finally {
      setBusy("");
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    await perform(
      "save",
      async () => {
        const saved = await api<Ticket>(
          `/tickets/${pathId(ticket.id)}`,
          "PATCH",
          { ...draft, title: draft.title.trim(), version },
        );
        setDraft(draftFrom(saved));
        setVersion(saved.version);
        setDirty(false);
        setConflict(false);
      },
      "Changes saved.",
    );
  }
  const project = state.projects.find((item) => item.id === ticket.projectId);
  const stages = state.stages
    .filter((item) => item.projectId === ticket.projectId)
    .sort((a, b) => a.position - b.position);
  const owner = state.agents.find((item) => item.id === ticket.ownerId);
  const execution = ticket.execution;
  const active = isActive(execution);
  const stale = isStale(execution);
  const availability = integrations?.agents.find(
    (item) => item.id === ticket.ownerId,
  );
  const startReason = dirty
    ? "Save your changes before starting an agent."
    : !ticket.ownerId
      ? "Assign an owner to start this ticket."
      : ticket.blockedReason
        ? `Blocked: ${ticket.blockedReason}`
        : ticket.archived
          ? "Restore this ticket before starting."
          : owner && !owner.enabled
            ? "This agent is disabled. Enable it in Agents."
            : availability?.available === false
              ? availability.reason || "This agent cannot start locally."
              : null;
  const links = state.tickets.filter(
    (item) => item.projectId === ticket.projectId && item.id !== ticket.id,
  );
  const updatedElsewhere = dirty && ticket.version !== version;
  return (
    <Modal
      title={ticketKey(ticket, state.projects)}
      subtitle={project?.name}
      drawer
      onClose={close}
    >
      <div className="drawer-scroll">
        {confirmDiscard && (
          <div className="discard-confirm">
            <p>You have unsaved changes.</p>
            <button
              className="button small-button"
              onClick={() => setConfirmDiscard(false)}
            >
              Keep editing
            </button>
            <button className="button danger small-button" onClick={onClose}>
              Discard and close
            </button>
          </div>
        )}
        {error && <ErrorNotice>{error}</ErrorNotice>}
        {notice && (
          <div className="success-notice" role="status">
            <Check size={15} />
            {notice}
          </div>
        )}
        {(updatedElsewhere || conflict) && (
          <div className="warning-notice">
            <AlertTriangle size={16} />
            <div>
              This ticket changed in another session. Your draft is preserved.
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setDraft(draftFrom(ticket));
                  setVersion(ticket.version);
                  setDirty(false);
                  setConflict(false);
                  setError("");
                }}
              >
                Discard draft and load latest
              </button>
            </div>
          </div>
        )}
        <form
          id="ticket-detail-form"
          onSubmit={save}
          className="ticket-detail-form"
        >
          <label className="sr-only" htmlFor="ticket-title">
            Title
          </label>
          <textarea
            id="ticket-title"
            className="detail-title"
            required
            rows={2}
            maxLength={500}
            value={draft.title}
            onChange={(event) => change("title", event.target.value)}
          />
          <div className="detail-properties">
            <label>
              Stage
              <select
                value={draft.stageId}
                onChange={(event) => change("stageId", event.target.value)}
              >
                {stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select
                value={draft.priority}
                onChange={(event) =>
                  change("priority", event.target.value as Ticket["priority"])
                }
              >
                {priorities.map((value) => (
                  <option key={value} value={value}>
                    {capitalize(value)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Owner
              <select
                value={draft.ownerId || ""}
                disabled={active}
                onChange={(event) =>
                  change("ownerId", event.target.value || null)
                }
              >
                <option value="">Unassigned</option>
                {state.agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                    {agent.enabled ? "" : " (disabled)"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Labels
              <input
                value={(draft.labels || []).join(", ")}
                onChange={(event) =>
                  change(
                    "labels",
                    event.target.value.split(",").map((label) => label.trim()),
                  )
                }
                onBlur={() =>
                  change("labels", [
                    ...new Set((draft.labels || []).filter(Boolean)),
                  ])
                }
                placeholder="Separate with commas"
              />
            </label>
          </div>
          {active && (
            <p className="field-hint">
              The active executor retains ownership. Checkpoint and release the
              session before a handoff.
            </p>
          )}
          <label className="detail-label">
            Description
            <textarea
              rows={7}
              value={draft.description || ""}
              onChange={(event) => change("description", event.target.value)}
              placeholder="Add context, acceptance criteria, and useful links…"
            />
          </label>
          <details className="detail-disclosure">
            <summary>
              Relationships & blockers{" "}
              <span>
                {(draft.dependsOn?.length || 0) + (draft.parentId ? 1 : 0) ||
                  ""}
              </span>
            </summary>
            <div className="relationship-fields">
              <label>
                Parent ticket
                <select
                  value={draft.parentId || ""}
                  onChange={(event) =>
                    change("parentId", event.target.value || null)
                  }
                >
                  <option value="">No parent</option>
                  {links.map((item) => (
                    <option key={item.id} value={item.id}>
                      {ticketKey(item, state.projects)} · {item.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Depends on
                <select
                  multiple
                  size={Math.min(4, Math.max(2, links.length))}
                  value={draft.dependsOn || []}
                  onChange={(event) =>
                    change(
                      "dependsOn",
                      Array.from(
                        event.target.selectedOptions,
                        (option) => option.value,
                      ),
                    )
                  }
                >
                  {links.map((item) => (
                    <option key={item.id} value={item.id}>
                      {ticketKey(item, state.projects)} · {item.title}
                    </option>
                  ))}
                </select>
                <span className="field-hint">
                  Use ⌘ / Ctrl to select or remove dependencies.
                </span>
              </label>
              <label>
                Blocker
                <input
                  value={draft.blockedReason || ""}
                  onChange={(event) =>
                    change("blockedReason", event.target.value)
                  }
                  placeholder="What is blocking progress, and who can resolve it?"
                />
              </label>
            </div>
          </details>
        </form>
        <section className="detail-section">
          <div className="section-title">
            <h3>Agent execution</h3>
            {execution && (
              <span
                className={`status-chip ${stale ? "warning" : active ? "active" : ""}`}
              >
                {stale ? "Heartbeat stale" : execution.state}
              </span>
            )}
          </div>
          <div className="execution-owner">
            <AgentAvatar agent={owner} />
            <div>
              <strong>{owner?.name || "No owner assigned"}</strong>
              <span>
                {active
                  ? execution?.external
                    ? "Externally managed session"
                    : "Active local session"
                  : "Explicit start · independent execution"}
              </span>
            </div>
            {active ? (
              <button
                className="button small-button danger"
                disabled={!!busy || !!execution?.external}
                onClick={() =>
                  void perform(
                    "stop",
                    () => api(`/tickets/${pathId(ticket.id)}/stop`, "POST"),
                    "Stop request recorded.",
                  )
                }
              >
                <Square size={12} />
                {busy === "stop" ? "Stopping…" : "Stop"}
              </button>
            ) : (
              <button
                className="button primary small-button"
                disabled={!!busy || !!startReason}
                title={startReason || undefined}
                onClick={() =>
                  void perform(
                    "start",
                    () => api(`/tickets/${pathId(ticket.id)}/start`, "POST"),
                    "Agent started.",
                  )
                }
              >
                <Play size={13} />
                {busy === "start" ? "Starting…" : "Start agent"}
              </button>
            )}
          </div>
          {startReason && !active && (
            <p className="field-hint">{startReason}</p>
          )}
          {execution?.external && active && (
            <p className="field-hint">
              This session was started outside Agent Desk. Stop or checkpoint it
              in its original agent client.
            </p>
          )}
          {execution && (
            <div className="execution-details">
              {execution.summary && <p>{execution.summary}</p>}
              {typeof execution.progress === "number" && (
                <div className="progress-line">
                  <progress
                    max="100"
                    value={Math.max(0, Math.min(100, execution.progress))}
                    aria-label="Reported progress"
                  />
                  <span>{execution.progress}% reported</span>
                </div>
              )}
              <div className="execution-facts">
                <span title={execution.heartbeatAt || undefined}>
                  <Clock3 size={13} />
                  Heartbeat {timeAgo(execution.heartbeatAt)}
                </span>
                {execution.branch && (
                  <span title={execution.branch}>
                    <GitBranch size={13} />
                    {execution.branch}
                  </span>
                )}
                {safeUrl(execution.prUrl) && (
                  <a
                    href={safeUrl(execution.prUrl)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <GitPullRequest size={13} />
                    Pull request
                    <ExternalLink size={11} />
                  </a>
                )}
              </div>
              {stale && (
                <p className="warning-text">
                  No recent heartbeat. The claim is still owned by this session;
                  no automatic takeover.
                </p>
              )}
              <details className="session-reference">
                <summary>Session reference</summary>
                <dl>
                  <dt>Session</dt>
                  <dd>{execution.sessionId}</dd>
                  <dt>Execution</dt>
                  <dd>{execution.id}</dd>
                  {execution.worktreePath && (
                    <>
                      <dt>Worktree</dt>
                      <dd>{execution.worktreePath}</dd>
                    </>
                  )}
                  {execution.headSha && (
                    <>
                      <dt>Head</dt>
                      <dd>{execution.headSha}</dd>
                    </>
                  )}
                </dl>
              </details>
            </div>
          )}
          {execution?.external && active && (
            <ReconcileSessions
              execution={execution}
              disabled={!!busy || dirty}
              refresh={refresh}
            />
          )}
          <button
            className="text-button"
            type="button"
            aria-expanded={handoff}
            onClick={() => setHandoff(!handoff)}
          >
            <ArrowRightLeft size={13} />
            Record a handoff
          </button>
          {handoff && (
            <div className="handoff-form">
              <label>
                Next owner
                <select
                  value={handoffOwner}
                  onChange={(event) => setHandoffOwner(event.target.value)}
                >
                  <option value="">Choose an agent</option>
                  {state.agents
                    .filter((agent) => agent.id !== ticket.ownerId)
                    .map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Checkpoint summary
                <textarea
                  rows={3}
                  value={handoffSummary}
                  onChange={(event) => setHandoffSummary(event.target.value)}
                  placeholder="Completed work, current state, and the next step…"
                />
              </label>
              {active && (
                <p className="field-hint">
                  Release the current execution before handing off.
                </p>
              )}
              <button
                className="button small-button"
                disabled={
                  !!busy ||
                  active ||
                  dirty ||
                  !handoffOwner ||
                  !handoffSummary.trim()
                }
                onClick={() =>
                  void perform(
                    "handoff",
                    async () => {
                      await api(
                        `/tickets/${pathId(ticket.id)}/handoff`,
                        "POST",
                        {
                          ownerId: handoffOwner,
                          summary: handoffSummary.trim(),
                        },
                      );
                      setHandoff(false);
                      setHandoffSummary("");
                    },
                    "Handoff recorded.",
                  )
                }
              >
                <ArrowRightLeft size={13} />
                Confirm handoff
              </button>
            </div>
          )}
        </section>
        <section className="detail-section">
          <div className="section-title">
            <h3>
              <Github size={15} />
              GitHub
            </h3>
            {ticket.github?.syncState && (
              <span
                className={`status-chip ${ticket.github.error || ticket.github.conflict ? "warning" : ""}`}
              >
                {ticket.github.syncState}
              </span>
            )}
          </div>
          {safeUrl(ticket.github?.url) ? (
            <a
              className="github-link"
              href={safeUrl(ticket.github?.url)}
              target="_blank"
              rel="noreferrer"
            >
              {project?.repo} #{ticket.github?.number}
              <ExternalLink size={13} />
            </a>
          ) : (
            <div className="github-empty">
              <p>
                {project?.repo
                  ? "This ticket has not been published to GitHub."
                  : "Connect a GitHub repository in project settings to publish this ticket."}
              </p>
              {project?.repo && (
                <button
                  className="button small-button"
                  disabled={!!busy || dirty}
                  onClick={() =>
                    void perform(
                      "publish",
                      () =>
                        api(`/tickets/${pathId(ticket.id)}/publish`, "POST"),
                      "GitHub issue published.",
                    )
                  }
                >
                  <Github size={13} />
                  {busy === "publish" ? "Publishing…" : "Publish issue"}
                </button>
              )}
            </div>
          )}
          {ticket.github?.dirty && (
            <p className="field-hint">Local changes are waiting to sync.</p>
          )}
          {ticket.github?.error && (
            <ErrorNotice>{ticket.github.error}</ErrorNotice>
          )}
          {ticket.github?.conflict ? (
            <div className="github-conflict">
              <p>
                <AlertTriangle size={14} />
                Both this ticket and GitHub changed. Choose which version to
                keep.
              </p>
              <details>
                <summary>Review conflict</summary>
                <pre>
                  {typeof ticket.github.conflict === "string"
                    ? ticket.github.conflict
                    : JSON.stringify(ticket.github.conflict, null, 2)}
                </pre>
              </details>
              <div className="button-row">
                <button
                  className="button small-button"
                  disabled={!!busy || dirty}
                  onClick={() =>
                    void perform(
                      "resolve",
                      () =>
                        api(`/tickets/${pathId(ticket.id)}/resolve`, "POST", {
                          choice: "local",
                        }),
                      "Local version selected.",
                    )
                  }
                >
                  Keep local version
                </button>
                <button
                  className="button small-button"
                  disabled={!!busy || dirty}
                  onClick={() =>
                    void perform(
                      "resolve",
                      () =>
                        api(`/tickets/${pathId(ticket.id)}/resolve`, "POST", {
                          choice: "remote",
                        }),
                      "GitHub version selected.",
                    )
                  }
                >
                  Use GitHub version
                </button>
              </div>
            </div>
          ) : null}
          {ticket.github && project && (
            <button
              className="text-button"
              disabled={!!busy}
              onClick={() =>
                void perform(
                  "sync",
                  () =>
                    api(`/projects/${pathId(project.id)}/sync`, "POST", {
                      direction: "both",
                    }),
                  "Project sync queued.",
                )
              }
            >
              <RefreshCw size={13} />
              Sync project
            </button>
          )}
        </section>
        {state.tickets.some((item) => item.parentId === ticket.id) && (
          <section className="detail-section">
            <h3>Child tickets</h3>
            {state.tickets
              .filter((item) => item.parentId === ticket.id)
              .map((item) => (
                <button
                  key={item.id}
                  className="child-ticket"
                  onClick={() => {
                    if (dirty) setConfirmDiscard(true);
                    else onOpen(item.id);
                  }}
                >
                  <span className="ticket-id">
                    {ticketKey(item, state.projects)}
                  </span>
                  {item.title}
                </button>
              ))}
          </section>
        )}
        <section className="detail-section">
          <div className="section-title">
            <h3>Activity</h3>
            <span className="muted small">
              {
                state.activity.filter((item) => item.ticketId === ticket.id)
                  .length
              }{" "}
              updates
            </span>
          </div>
          <form
            className="comment-form"
            onSubmit={(event) => {
              event.preventDefault();
              void perform(
                "comment",
                async () => {
                  await api(`/tickets/${pathId(ticket.id)}/comments`, "POST", {
                    summary: comment.trim(),
                  });
                  setComment("");
                },
                "Comment added.",
              );
            }}
          >
            <label className="sr-only" htmlFor="new-comment">
              Add a comment
            </label>
            <textarea
              id="new-comment"
              rows={2}
              placeholder="Add an update or leave a note…"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
            <button
              className="button small-button"
              disabled={!!busy || !comment.trim()}
            >
              <MessageSquare size={13} />
              {busy === "comment" ? "Posting…" : "Comment"}
            </button>
          </form>
          <ActivityFeed
            compact
            items={state.activity.filter((item) => item.ticketId === ticket.id)}
            state={state}
          />
        </section>
        <p className="detail-timestamps">
          Created {timeAgo(ticket.createdAt)} · Updated{" "}
          {timeAgo(ticket.updatedAt)}
        </p>
      </div>
      <div className="drawer-footer">
        <button
          type="button"
          className="button subtle small-button"
          disabled={!!busy || dirty || active}
          onClick={() =>
            void perform(
              "archive",
              () =>
                api(`/tickets/${pathId(ticket.id)}`, "PATCH", {
                  version: ticket.version,
                  archived: !ticket.archived,
                }),
              ticket.archived ? "Ticket restored." : "Ticket archived.",
            )
          }
        >
          <Archive size={14} />
          {ticket.archived ? "Restore" : "Archive"}
        </button>
        <span className="muted small">
          {dirty ? "Unsaved changes" : "All changes saved"}
        </span>
        <button
          type="submit"
          form="ticket-detail-form"
          className="button primary"
          disabled={!!busy || !dirty || !draft.title.trim() || updatedElsewhere}
        >
          <Save size={14} />
          {busy === "save" ? "Saving…" : "Save changes"}
        </button>
      </div>
    </Modal>
  );
}
