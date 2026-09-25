import { useRef, useState } from "react";
import { api, ApiError, errorMessage, pathId } from "../api";
import type { Agent, DeskState, Integrations, Ticket } from "../types";
import type { TransitionResult } from "./StageTransition";
import { isActive, Modal, ticketKey } from "./shared";
import { PlanningProgress } from "./PlanningProgress";

function executable(agent: Agent) {
  return agent.enabled;
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
  onPhaseChange,
  onOpen,
  projectId,
}: {
  tickets: Ticket[];
  state: DeskState;
  integrations: Integrations | null;
  boardError?: string;
  onClose: () => void;
  onComplete: (admittedIds: string[]) => Promise<void>;
  onPhaseChange: (phase: "preview" | "submitting" | "finished") => void;
  onOpen: (id: string) => void;
  projectId?: string;
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
  const [snapshots, setSnapshots] = useState<Record<string, Ticket>>({});
  const [refreshError, setRefreshError] = useState("");
  const submitted = useRef(false);
  const latest = useRef({ state, integrations });
  latest.current = { state, integrations };
  const owner = state.agents.find((agent) => agent.id === ownerId);
  const canMove = !!owner && executable(owner);
  const eligible = tickets.filter((ticket) => !candidate(ticket, state).reason);

  async function confirm() {
    if (submitted.current || !canMove || !eligible.length) return;
    submitted.current = true;
    setPhase("submitting");
    onPhaseChange("submitting");
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
          // A malformed success is ambiguous, not evidence of a stage change.
          if (
            response.ticket?.id !== ticket.id ||
            response.ticket.stageId !== target.stageId ||
            response.outcome !== "moved"
          ) {
            throw new Error(
              "The server returned an unexpected transition result.",
            );
          }
          admitted.push(ticket.id);
          setSnapshots((current) => ({
            ...current,
            [ticket.id]: response.ticket,
          }));
          result = "Moved to Planning · awaiting agent update.";
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
      setRefreshError(errorMessage(error));
    } finally {
      setPhase("finished");
      onPhaseChange("finished");
    }
  }

  if (phase !== "preview")
    return (
      <PlanningProgress
        state={state}
        tickets={tickets.map((ticket) => snapshots[ticket.id] || ticket)}
        results={results}
        submitting={phase === "submitting"}
        focus
        error={refreshError || boardError}
        onOpen={onOpen}
        onDismiss={onClose}
        projectId={projectId}
      />
    );

  return (
    <Modal
      title="Move tickets to Planning"
      subtitle={`${tickets.length} selected ${tickets.length === 1 ? "ticket" : "tickets"}`}
      onClose={() => {
        if (!submitted.current) onClose();
      }}
    >
      <div className="dialog-form">
        <p>
          Choose one agent to prepare specifications and independent
          implementation tickets. Confirming moves eligible Backlog tickets to
          their own project's Planning stage. Assigned agents start in their own clients and report progress.
        </p>
        <label>
          Planning agent
          <select
            value={ownerId}
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
        <p role="status">
          {`${eligible.length} eligible · ${tickets.length - eligible.length} will not move`}
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
                  {reason
                    ? `Will not move: ${reason}`
                    : "Ready for confirmation"}
                </p>
              </li>
            );
          })}
        </ul>
        <div className="dialog-footer">
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={!canMove || !eligible.length}
            onClick={() => void confirm()}
          >
            Move to Planning
          </button>
        </div>
      </div>
    </Modal>
  );
}
