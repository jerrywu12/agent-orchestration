import { useEffect, useRef, useState } from "react";
import { ClipboardList, Radio } from "lucide-react";
import { api, errorMessage, pathId } from "../api";
import type { TaskBrief } from "../intake-types";
import { emptyBrief } from "../intake";
import type { DeskState, Integrations, Stage, Ticket } from "../types";
import { ExecutionTracking } from "./ExecutionTracking";
import { BriefFields } from "./WorkflowBrief";
import { ErrorNotice, isActive, isExternalAgent, Modal, ticketKey } from "./shared";

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
  refresh,
  onClose,
  onResult,
}: {
  ticket: Ticket;
  stage: Stage;
  state: DeskState;
  integrations: Integrations | null;
  refresh: () => Promise<void>;
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
  // The preparation edited here is the only brief write outside intake; it carries
  // the version this dialog knows so a concurrent change cannot be overwritten.
  const [version, setVersion] = useState(ticket.version);
  const [editing, setEditing] = useState(false);
  const [brief, setBrief] = useState<TaskBrief>(() => ({
    ...emptyBrief(),
    ...ticket.brief,
  }));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const current = state.tickets.find((item) => item.id === ticket.id);
  const stale = !!current && current.version !== version && !saving;
  // The reservation is read from the refreshed record so a release performed here
  // clears the hold; the server still decides whether a claim may be released.
  const execution = (current ?? ticket).execution;
  const held = isActive(execution);
  const owner = state.agents.find((item) => item.id === ownerId);
  const availability = integrations?.agents.find((item) => item.id === ownerId);
  const external = isExternalAgent(owner);
  const unavailable =
    !owner?.enabled || (!external && availability?.available === false);
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
  // The release is recorded on the execution, so the reservation clearing is what
  // reports it here; the tracking panel unmounts with the hold it resolved.
  const wasHeld = useRef(held);
  useEffect(() => {
    if (wasHeld.current && !held) {
      setInspecting(false);
      setNotice(
        "The prior claim is released. Existing work and session history are preserved.",
      );
    }
    wasHeld.current = held;
  }, [held]);
  async function saveSpec() {
    if (busy || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await api<Ticket>(
        `/tickets/${pathId(ticket.id)}`,
        "PATCH",
        { version, brief },
      );
      setVersion(saved.version);
      setBrief({ ...emptyBrief(), ...saved.brief });
      setEditing(false);
      setNotice("Spec saved. Readiness reflects the recorded preparation.");
      setRetry((value) => value + 1);
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  }
  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<TransitionResult>(
        `/tickets/${pathId(ticket.id)}/transition`,
        "POST",
        {
          version,
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
        if (!busy && !saving) onClose();
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
        {held && (
          <>
            <ErrorNotice>
              An existing execution owns this ticket. Checkpoint and release it
              before changing its stage.
            </ErrorNotice>
            <div className="readiness-actions">
              <button
                type="button"
                className="button small-button"
                aria-expanded={inspecting}
                disabled={busy || saving}
                onClick={() => setInspecting((value) => !value)}
              >
                <Radio size={14} />
                {inspecting ? "Hide execution trace" : "Release claim"}
              </button>
            </div>
            {inspecting && (
              <ExecutionTracking
                ticketId={ticket.id}
                executionId={execution?.id}
                disabled={busy || saving}
                refresh={refresh}
              />
            )}
          </>
        )}
        {notice && (
          <p className="field-hint" role="status">
            {notice}
          </p>
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
        {ownerId && external && (
          <p className="field-hint">
            Reports through CLI/MCP; start in client or connector.
          </p>
        )}
        {ownerId && !external && availability?.available === false && (
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
                {!readiness.ready && (
                  <div className="readiness-actions">
                    <button
                      type="button"
                      className="button small-button"
                      aria-expanded={editing}
                      disabled={busy || saving}
                      onClick={() => {
                        setNotice("");
                        setEditing((value) => !value);
                      }}
                    >
                      <ClipboardList size={14} />
                      {editing ? "Hide spec editor" : "Update Spec"}
                    </button>
                  </div>
                )}
                {editing && (
                  <>
                    <p className="field-hint">
                      Record the preparation this ticket is missing, then save
                      to recheck. Scope reserved by another ticket's execution
                      is released there, not here.
                    </p>
                    <BriefFields
                      value={brief}
                      onChange={setBrief}
                      disabled={busy || saving}
                    />
                    <div className="readiness-actions">
                      <button
                        type="button"
                        className="button primary small-button"
                        disabled={busy || saving || stale}
                        onClick={() => void saveSpec()}
                      >
                        {saving ? "Saving…" : "Save spec"}
                      </button>
                      <button
                        type="button"
                        className="button small-button"
                        disabled={busy || saving}
                        onClick={() => {
                          setBrief({
                            ...emptyBrief(),
                            ...(current?.brief ?? ticket.brief),
                          });
                          setEditing(false);
                          setNotice("");
                        }}
                      >
                        Discard spec edits
                      </button>
                    </div>
                  </>
                )}
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
          <button
            className="button"
            disabled={busy || saving}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={
              busy ||
              saving ||
              loading ||
              stale ||
              !ownerId ||
              unavailable ||
              held ||
              (!planning && !readiness?.ready)
            }
            onClick={() => void confirm()}
          >
            {busy
              ? "Starting…"
              : planning
                ? external
                  ? "Confirm planning"
                  : "Confirm and start planning"
                : external
                  ? "Confirm"
                  : "Confirm and start"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
