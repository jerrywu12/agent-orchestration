import { useEffect, useState } from "react";
import { api, errorMessage, pathId } from "../api";
import type { DeskState, Integrations, Stage, Ticket } from "../types";
import { ErrorNotice, isActive, Modal, ticketKey } from "./shared";

interface Readiness {
  ready: boolean;
  missing: string[];
  holds: string[];
  conflicts: {
    ticketId: string;
    key: string;
    title: string;
    reasons: string[];
  }[];
}
const preparationLabels: Record<string, string> = {
  specification: "Specification reference",
  acceptanceCriteria: "Acceptance criteria",
  scope: "Scope",
  verification: "Verification plan",
  allowedPaths: "Allowed paths",
  conflictKeys: "Shared resources",
};
export interface TransitionResult {
  ticket: Ticket;
  outcome: "started" | "queued" | "failed";
  reason?: string;
}

export function StageTransition({
  ticket,
  stage,
  state,
  integrations,
  onClose,
  onResult,
}: {
  ticket: Ticket;
  stage: Stage;
  state: DeskState;
  integrations: Integrations | null;
  onClose: () => void;
  onResult: (result: TransitionResult) => Promise<void>;
}) {
  const planning = stage.role === "planning";
  const [ownerId, setOwnerId] = useState(ticket.ownerId || "");
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!planning);
  const [retry, setRetry] = useState(0);
  const current = state.tickets.find((item) => item.id === ticket.id);
  const stale = !!current && current.version !== ticket.version;
  const owner = state.agents.find((item) => item.id === ownerId);
  const availability = integrations?.agents.find((item) => item.id === ownerId);
  const unavailable = !owner?.enabled || availability?.available === false;
  useEffect(() => {
    if (planning) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void api<Readiness>(`/tickets/${pathId(ticket.id)}/readiness`)
      .then((result) => {
        if (!cancelled) setReadiness(result);
      })
      .catch((failure) => {
        if (!cancelled) setError(errorMessage(failure));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticket.id, planning, retry]);
  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<TransitionResult>(
        `/tickets/${pathId(ticket.id)}/transition`,
        "POST",
        {
          version: ticket.version,
          stageId: stage.id,
          ownerId,
          confirmed: true,
        },
      );
      await onResult(result);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={planning ? "Start planning" : "Move to Ready"}
      subtitle={`${ticketKey(ticket, state.projects)} · ${ticket.title}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="dialog-form">
        <p>
          {planning
            ? "Choose the agent that will prepare the specification and independent implementation tickets."
            : "Choose the development agent. Confirming reserves this scope and starts work, or queues it until the agent is available."}
        </p>
        {error && <ErrorNotice>{error}</ErrorNotice>}
        {stale && (
          <ErrorNotice>
            This ticket changed. Cancel and reopen this action to review the
            latest version.
          </ErrorNotice>
        )}
        {isActive(ticket.execution) && (
          <ErrorNotice>
            An existing execution owns this ticket. Checkpoint and release it
            before changing its stage.
          </ErrorNotice>
        )}
        <label>
          {planning ? "Planning agent" : "Development agent"}
          <select
            value={ownerId}
            disabled={busy}
            onChange={(event) => setOwnerId(event.target.value)}
          >
            <option value="">Select an agent</option>
            {state.agents.map((agent) => (
              <option key={agent.id} value={agent.id} disabled={!agent.enabled}>
                {agent.name}
                {agent.enabled ? "" : " (disabled)"}
              </option>
            ))}
          </select>
        </label>
        {ownerId && availability?.available === false && (
          <p className="field-hint">
            {availability.reason || "This agent cannot start locally."}
          </p>
        )}
        {!planning && (
          <section aria-label="Build readiness" aria-live="polite">
            {loading ? (
              <p>Checking preparation and overlapping work…</p>
            ) : readiness ? (
              <>
                <p>
                  {readiness.ready
                    ? "Preparation complete. No conflicting work found."
                    : "This ticket is not ready to build."}
                </p>
                {!!readiness.missing.length && (
                  <>
                    <strong>Complete during Planning</strong>
                    <ul>
                      {readiness.missing.map((item) => (
                    <li key={item}>{preparationLabels[item] || item}</li>
                      ))}
                    </ul>
                  </>
                )}
                {!!readiness.holds.length && (
                  <ul>
                    {readiness.holds.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
                {readiness.conflicts.map((item) => (
                  <div key={item.ticketId}>
                    <strong>
                      {item.key} · {item.title}
                    </strong>
                    <ul>
                      {item.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </>
            ) : (
              <button
                className="button"
                onClick={() => setRetry((value) => value + 1)}
              >
                Retry readiness check
              </button>
            )}
          </section>
        )}
        <div className="dialog-footer">
          <button className="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={
              busy ||
              loading ||
              stale ||
              !ownerId ||
              unavailable ||
              isActive(ticket.execution) ||
              (!planning && !readiness?.ready)
            }
            onClick={() => void confirm()}
          >
            {busy
              ? "Starting…"
              : planning
                ? "Confirm and start planning"
                : "Confirm and start"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
