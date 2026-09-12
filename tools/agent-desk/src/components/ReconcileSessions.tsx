import { useState, type FormEvent } from "react";
import { Check, FileCheck2 } from "lucide-react";
import { api, errorMessage, pathId } from "../api";
import type { Execution } from "../types";
import { ErrorNotice } from "./shared";

export function ReconcileSessions({
  execution,
  disabled,
  refresh,
}: {
  execution: Execution;
  disabled: boolean;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const sessions = [
    {
      sessionId: execution.sessionId,
      sourceSessionId: undefined as string | undefined,
      released: !!execution.primaryReconciled,
      primary: true,
    },
    ...(execution.heldSessions || [])
      .filter((session) => session.sessionId !== execution.sessionId)
      .map((session) => ({
        ...session,
        released: !!session.releasedAt,
        primary: false,
      })),
  ];
  return (
    <details className="reconciliation">
      <summary>
        Reconcile imported sessions ·{" "}
        {sessions.filter((session) => !session.released).length} held
      </summary>
      <p>
        For each exact session, stop or checkpoint it in its original app, then
        record the evidence here. The ticket stays claimed until every held
        session is reconciled.
      </p>
      {sessions.map((session) => (
        <SessionForm
          key={session.sessionId}
          executionId={execution.id}
          sessionId={session.sessionId}
          sourceSessionId={session.sourceSessionId}
          primary={session.primary}
          released={session.released}
          disabled={disabled || busy}
          onBusy={setBusy}
          refresh={refresh}
        />
      ))}
    </details>
  );
}
function SessionForm({
  executionId,
  sessionId,
  sourceSessionId,
  primary,
  released,
  disabled,
  onBusy,
  refresh,
}: {
  executionId: string;
  sessionId: string;
  sourceSessionId?: string;
  primary: boolean;
  released: boolean;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  refresh: () => Promise<void>;
}) {
  const [evidence, setEvidence] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recorded, setRecorded] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!confirmed || !evidence.trim()) return;
    setError("");
    setBusy(true);
    onBusy(true);
    try {
      await api(`/executions/${pathId(executionId)}/reconcile`, "POST", {
        sessionId,
        summary: evidence.trim(),
        stopped: true,
      });
      setRecorded(true);
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <div className="reconcile-session">
      <div className="section-title">
        <h4>
          {primary ? "Primary source session" : "Additional source session"}
        </h4>
        {(released || recorded) && (
          <span className="status-chip active">
            <Check size={10} />
            Checkpoint recorded
          </span>
        )}
      </div>
      <p className="source-identity">
        Session: <code>{sessionId}</code>
        {sourceSessionId && sourceSessionId !== sessionId && (
          <>
            <br />
            Source record: <code>{sourceSessionId}</code>
          </>
        )}
      </p>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {!released && !recorded && (
        <form onSubmit={submit}>
          <label>
            Checkpoint evidence
            <textarea
              rows={3}
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
              placeholder="Where you stopped this session, the saved checkpoint, and the work that remains…"
              required
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              required
            />
            I confirm this exact source session has been stopped or checkpointed
            in its original app and is safe to release.
          </label>
          <button
            className="button small-button"
            disabled={disabled || !confirmed || !evidence.trim()}
          >
            <FileCheck2 size={13} />
            {busy ? "Recording…" : "Record checkpoint"}
          </button>
        </form>
      )}
    </div>
  );
}
