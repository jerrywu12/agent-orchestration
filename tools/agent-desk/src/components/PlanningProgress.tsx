import { useEffect, useRef, useState } from "react";
import type { DeskState, Ticket } from "../types";
import type { RunResult } from "../bulk-types";
import { ErrorNotice, isActive, ticketKey } from "./shared";
import { heartbeatStale, RunProgress } from "./RunProgress";

function currentPlanningExecution(ticket: Ticket) {
  const execution = ticket.execution;
  if (execution?.purpose !== "planning") return null;
  const stageChangedAt = Date.parse(ticket.stageChangedAt || "");
  const startedAt = Date.parse(execution.startedAt || "");
  if (Number.isFinite(stageChangedAt) &&
      (!Number.isFinite(startedAt) || startedAt < stageChangedAt))
    return null;
  return execution;
}

export function planningIsWorking(ticket: Ticket, now = Date.now()) {
  const execution = currentPlanningExecution(ticket);
  const historicalStart = ticket.launchIntent;
  if (historicalStart?.purpose === "planning" && historicalStart.status === "started" &&
      historicalStart.executionId !== execution?.id)
    return false;
  const heartbeat = Date.parse(execution?.heartbeatAt || "");
  return (
    execution?.purpose === "planning" &&
    execution.state === "running" &&
    !execution.releasedAt &&
    !execution.stale &&
    Number.isFinite(heartbeat) &&
    now - heartbeat <= 90000
  );
}

function projection(ticket: Ticket): RunResult | null {
  const historicalStart =
    ticket.launchIntent?.purpose === "planning" &&
    ticket.launchIntent.status === "started"
      ? ticket.launchIntent
      : null;
  const intent =
    ticket.launchIntent?.purpose === "planning" &&
    ["queued", "failed"].includes(ticket.launchIntent.status)
      ? ticket.launchIntent
      : null;
  if (intent?.status === "queued")
    return {
      ticketId: ticket.id,
      status: "queued",
      message: intent.reason || "Waiting for planner capacity.",
      queuedAt: intent.createdAt,
    };
  if (intent?.status === "failed")
    return {
      ticketId: ticket.id,
      status: "failed",
      message:
        intent.reason ||
        "Planning agent failed to start. Open the ticket to inspect the launch failure.",
    };
  const execution = currentPlanningExecution(ticket);
  if (historicalStart &&
      (!historicalStart.executionId || historicalStart.executionId !== execution?.id))
    return {
      ticketId: ticket.id,
      status: "skipped",
      message: historicalStart.reason || "Waiting for the recorded planning session to report progress.",
    };
  if (!execution)
    return {
      ticketId: ticket.id,
      status: "skipped",
      message: "Assigned; waiting for the agent to claim this ticket and report progress.",
    };
  return {
    ticketId: ticket.id,
    executionId: execution.id,
    status: isActive(execution)
      ? "running"
      : ["awaiting_review", "complete", "completed"].includes(execution.state)
        ? "awaiting_review"
        : execution.state === "checkpointed"
          ? "checkpointed"
          : "failed",
    message:
      execution.summary ||
      "Waiting for the planning agent's first progress report.",
    telemetry: {
      state: execution.state,
      summary: execution.summary || "",
      progress: execution.progress ?? null,
      startedAt: execution.startedAt ?? null,
      heartbeatAt: execution.heartbeatAt ?? null,
      lastActivityAt: execution.lastActivityAt ?? null,
      releasedAt: execution.releasedAt ?? null,
      reportingReadyAt: execution.reportingReadyAt ?? null,
      stale: execution.stale ?? false,
    },
  };
}

export function PlanningProgress({
  state,
  tickets = [],
  results = {},
  submitting = false,
  error = "",
  focus = false,
  onOpen,
  onDismiss,
  projectId,
}: {
  state: DeskState;
  tickets?: Ticket[];
  results?: Record<string, string>;
  submitting?: boolean;
  error?: string;
  focus?: boolean;
  projectId?: string;
  onOpen: (id: string) => void;
  onDismiss?: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  const region = useRef<HTMLElement>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (focus) {
      region.current?.focus();
      region.current?.scrollIntoView({ block: "nearest" });
    }
  }, [focus]);
  // Response snapshots bridge a failed/delayed refresh, never override newer board state.
  const current = (snapshot: Ticket) => {
    const live = state.tickets.find((item) => item.id === snapshot.id);
    return live && live.version >= snapshot.version ? live : snapshot;
  };
  const rows = tickets.map(current);
  const ids = new Set(rows.map((ticket) => ticket.id));
  for (const ticket of state.tickets) {
    if (
      !ids.has(ticket.id) &&
      !ticket.archived &&
      (!projectId || ticket.projectId === projectId) &&
      state.stages.some(
        (stage) => stage.id === ticket.stageId && stage.role === "planning",
      )
    )
      rows.push(ticket);
  }
  if (!rows.length) return null;
  return (
    <section
      className="bulk-results planning-progress"
      aria-label="Planning progress"
      tabIndex={-1}
      ref={region}
    >
      <div className="bulk-results-heading">
        <h2>Planning progress</h2>
        <span>
          {rows.length} tickets · Updates with the board every 4 seconds
        </span>
        {onDismiss && !submitting && (
          <button className="text-button" onClick={onDismiss}>
            Dismiss planning results
          </button>
        )}
      </div>
      {submitting && <p role="status">Recording Planning stage changes…</p>}
      {error && (
        <ErrorNotice>
          Results above are retained, but the board could not refresh. {error}
        </ErrorNotice>
      )}
      <ul aria-label="Planning ticket outcomes">
        {rows.map((ticket) => {
          const result = projection(ticket);
          const bound =
            !!result?.executionId &&
            result.executionId === ticket.execution?.id;
          const working = bound && planningIsWorking(ticket, now);
          const active = bound && isActive(ticket.execution);
          const stale = result && heartbeatStale(result, now);
          const status =
            result?.status === "failed"
              ? "Planning failed · needs attention"
              : result?.status === "queued"
                ? "Queued"
                : working
                  ? ticket.blockedReason
                    ? "Working on blockers"
                    : "Planning agent working"
                  : stale
                    ? "Stale · needs attention"
                    : active
                      ? "Needs attention · inspect execution"
                      : ticket.blockedReason
                        ? "Needs attention · waiting on dependency or action"
                        : result?.status === "awaiting_review"
                          ? "Prepared for review"
                          : result?.status === "checkpointed"
                            ? "Planning checkpointed"
                            : "Awaiting agent update";
          return (
            <li key={ticket.id}>
              <button className="text-button" onClick={() => onOpen(ticket.id)}>
                {ticketKey(ticket, state.projects)} · {ticket.title}
              </button>
              {result && (
                <span
                  className={`status-chip ${working ? "active" : "warning"}`}
                >
                  {status}
                </span>
              )}
              {results[ticket.id] && <p>{results[ticket.id]}</p>}
              {!results[ticket.id] &&
                submitting &&
                tickets.some((item) => item.id === ticket.id) && (
                  <p>Waiting to submit…</p>
                )}
              {result && (
                <>
                  <p>{result.message}</p>
                  <RunProgress
                    result={result}
                    ticketKey={ticketKey(ticket, state.projects)}
                    now={now}
                    paused={!!error}
                  />
                </>
              )}
              {ticket.blockedReason && (
                <p>
                  <strong>
                    {working
                      ? "Blockers under investigation: "
                      : "Remaining blocker: "}
                  </strong>
                  {ticket.blockedReason}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
