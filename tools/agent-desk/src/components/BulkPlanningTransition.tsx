import { useRef, useState } from "react";
import { api, ApiError, errorMessage, pathId } from "../api";
import type { Agent, DeskState, Integrations, Ticket } from "../types";
import type { TransitionResult } from "./StageTransition";
import { ErrorNotice, isActive, Modal, ticketKey } from "./shared";

function executable(agent: Agent) {
  return (
    agent.enabled &&
    (!agent.capabilities ||
      Array.isArray(agent.capabilities) ||
      agent.capabilities.execute !== false)
  );
}

function candidate(ticket: Ticket, state: DeskState) {
  const current = state.tickets.find((item) => item.id === ticket.id);
  const targets = state.stages.filter(
    (stage) =>
      stage.projectId === ticket.projectId && stage.role === "planning",
  );
  let reason = "";
  if (!current) reason = "Ticket is no longer available.";
  else if (current.archived) reason = "Archived tickets cannot move.";
  else if (isActive(current.execution))
    reason = "An existing execution owns this ticket. Release its claim first.";
  else if (current.version !== ticket.version)
    reason = "Ticket changed. Close and review its latest version.";
  else if (
    !state.stages.some(
      (stage) => stage.id === current.stageId && stage.role === "backlog",
    )
  )
    reason = "Only Backlog tickets can use this action.";
  else if (targets.length !== 1)
    reason = "This project does not have exactly one Planning stage.";
  return { stageId: targets[0]?.id, reason };
}

export function BulkPlanningTransition({
  tickets,
  state,
  integrations,
  boardError = "",
  onClose,
  onComplete,
}: {
  tickets: Ticket[];
  state: DeskState;
  integrations: Integrations | null;
  boardError?: string;
  onClose: () => void;
  onComplete: (admittedIds: string[]) => Promise<void>;
}) {
  const [ownerId, setOwnerId] = useState(() =>
    tickets.every((ticket) => ticket.ownerId === tickets[0]?.ownerId)
      ? tickets[0]?.ownerId || ""
      : "",
  );
  const [phase, setPhase] = useState<"preview" | "submitting" | "finished">(
    "preview",
  );
  const [results, setResults] = useState<Record<string, string>>({});
  const [refreshError, setRefreshError] = useState("");
  const submitted = useRef(false);
  const latest = useRef({ state, integrations });
  latest.current = { state, integrations };
  const owner = state.agents.find((agent) => agent.id === ownerId);
  const availability = integrations?.agents.find(
    (agent) => agent.id === ownerId,
  );
  const canStart =
    !!owner &&
    executable(owner) &&
    !!integrations &&
    availability?.available !== false;
  const eligible = tickets.filter((ticket) => !candidate(ticket, state).reason);

  async function confirm() {
    if (submitted.current || !canStart || !eligible.length) return;
    submitted.current = true;
    setPhase("submitting");
    const admitted: string[] = [];
    // Confirmation can narrow eligibility as state changes, never widen it.
    const confirmed = tickets.map((ticket) => ({
      ticket,
      target: candidate(ticket, latest.current.state),
    }));
    for (const { ticket, target: snapshot } of confirmed) {
      const target = snapshot.reason
        ? snapshot
        : candidate(ticket, latest.current.state);
      let result: string;
      if (target.reason) result = `Not moved: ${target.reason}`;
      else {
        setResults((current) => ({ ...current, [ticket.id]: "Confirming…" }));
        try {
          const response = await api<TransitionResult>(
            `/tickets/${pathId(ticket.id)}/transition`,
            "POST",
            {
              version: ticket.version,
              stageId: target.stageId,
              ownerId,
              confirmed: true,
            },
          );
          // A malformed success is ambiguous, not evidence of admission or launch.
          if (
            response.ticket?.id !== ticket.id ||
            response.ticket.stageId !== target.stageId ||
            !["started", "queued", "failed"].includes(response.outcome)
          ) {
            throw new Error(
              "The server returned an unexpected transition result.",
            );
          }
          admitted.push(ticket.id);
          result =
            response.outcome === "started"
              ? "Moved to Planning · planning agent started."
              : response.outcome === "queued"
                ? `Moved to Planning · queued. ${response.reason || "Waiting for planner capacity."}`
                : `Moved to Planning · agent failed to start. ${response.reason || "Open the ticket to inspect the launch failure."}`;
        } catch (error) {
          const refused =
            error instanceof ApiError &&
            error.status >= 400 &&
            error.status < 500 &&
            error.code !== "invalid_response";
          result = refused
            ? `Not moved: ${errorMessage(error)}`
            : `Outcome uncertain. ${errorMessage(error)} Inspect the current ticket before retrying; this request will not be replayed.`;
        }
      }
      setResults((current) => ({ ...current, [ticket.id]: result }));
    }
    try {
      await onComplete(admitted);
    } catch (error) {
      setRefreshError(
        `Results above are retained, but the board could not refresh. ${errorMessage(error)}`,
      );
    } finally {
      setPhase("finished");
    }
  }

  return (
    <Modal
      title="Move tickets to Planning"
      subtitle={`${tickets.length} selected ${tickets.length === 1 ? "ticket" : "tickets"}`}
      onClose={() => {
        if (!submitted.current || phase === "finished") onClose();
      }}
    >
      <div className="dialog-form">
        <p>
          Choose one agent to prepare specifications and independent
          implementation tickets. Confirming moves eligible Backlog tickets to
          their own project's Planning stage and starts or queues planning.
        </p>
        <label>
          Planning agent
          <select
            value={ownerId}
            disabled={phase !== "preview"}
            onChange={(event) => setOwnerId(event.target.value)}
          >
            <option value="">Select an agent</option>
            {state.agents.map((agent) => (
              <option
                key={agent.id}
                value={agent.id}
                disabled={!executable(agent)}
              >
                {agent.name}
                {executable(agent) ? "" : " (unavailable)"}
              </option>
            ))}
          </select>
        </label>
        {ownerId && !canStart && (
          <ErrorNotice>
            {availability?.reason ||
              "This planning agent is unavailable or availability is still loading."}
          </ErrorNotice>
        )}
        <p role="status">
          {phase === "preview"
            ? `${eligible.length} eligible · ${tickets.length - eligible.length} will not move`
            : phase === "submitting"
              ? "Submitting planning requests…"
              : "Planning requests finished. Review each ticket's outcome below."}
        </p>
        <ul
          className="bulk-planning-candidates"
          aria-label="Planning ticket outcomes"
          aria-live="polite"
        >
          {tickets.map((ticket) => {
            const reason = candidate(ticket, state).reason;
            return (
              <li key={ticket.id}>
                <strong>
                  {ticketKey(ticket, state.projects)} · {ticket.title}
                </strong>
                <p>
                  {results[ticket.id] ||
                    (reason
                      ? `Will not move: ${reason}`
                      : phase === "preview"
                        ? "Ready for confirmation"
                        : "Waiting to submit…")}
                </p>
              </li>
            );
          })}
        </ul>
        {refreshError && <ErrorNotice>{refreshError}</ErrorNotice>}
        {!refreshError && boardError && phase === "finished" && (
          <ErrorNotice>
            Results above are retained, but the board could not refresh.{" "}
            {boardError}
          </ErrorNotice>
        )}
        <div className="dialog-footer">
          <button
            className="button"
            disabled={phase === "submitting"}
            onClick={onClose}
          >
            {phase === "finished" ? "Close" : "Cancel"}
          </button>
          <button
            className="button primary"
            disabled={phase !== "preview" || !canStart || !eligible.length}
            onClick={() => void confirm()}
          >
            Confirm and start planning
          </button>
        </div>
      </div>
    </Modal>
  );
}
