import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { api, errorMessage, pathId } from "../api";
import type { ExecutionStatus } from "../bulk-types";
import { ErrorNotice, timeAgo } from "./shared";

const trackingLabels = {
  managed: "Managed runner",
  process: "Background process traced",
  recorded: "Recorded session",
  untraceable: "Prior session cannot be traced",
  none: "No current execution",
};
export function ExecutionTracking({
  ticketId,
  executionId,
  disabled,
  refresh,
}: {
  ticketId: string;
  executionId?: string | null;
  disabled: boolean;
  refresh: () => Promise<void>;
}) {
  const [status, setStatus] = useState<ExecutionStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [takingOver, setTakingOver] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (takingOver) return;
    let cancelled = false;
    let timer: number | undefined;
    setLoading(true);
    async function trace() {
      try {
        const next = await api<ExecutionStatus>(
          `/tickets/${pathId(ticketId)}/execution-status`,
        );
        if (cancelled) return;
        if (next.ticketId !== ticketId)
          throw new Error(
            "Execution trace is unavailable. Refresh the trace before recovering this claim.",
          );
        setStatus(next);
        setLoading(false);
        if (executionId) timer = window.setTimeout(() => void trace(), 4000);
      } catch (failure) {
        if (!cancelled) {
          setError(errorMessage(failure));
          setLoading(false);
        }
      }
    }
    void trace();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ticketId, executionId, revision, takingOver]);
  useEffect(() => {
    setAcknowledged(false);
  }, [status?.executionId, status?.sessionId, status?.lastHeartbeatAt]);
  const canTakeOver =
    !!status?.canTakeOver && status.processAlive !== true && !error && !loading;
  const nativeUrl =
    status?.nativeThreadUrl &&
    /^codex:\/\/threads\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
      status.nativeThreadUrl,
    )
      ? status.nativeThreadUrl
      : undefined;
  async function takeOver() {
    if (
      !status ||
      !canTakeOver ||
      disabled ||
      takingOver ||
      !reason.trim() ||
      !acknowledged
    )
      return;
    setTakingOver(true);
    setError("");
    setNotice("");
    try {
      const next = await api<ExecutionStatus>(
        `/tickets/${pathId(ticketId)}/takeover`,
        "POST",
        {
          executionId: status.executionId,
          sessionId: status.sessionId,
          expectedHeartbeatAt: status.lastHeartbeatAt,
          reason: reason.trim(),
          confirmed: true,
        },
      );
      setStatus(next);
      setConfirming(false);
      setReason("");
      setAcknowledged(false);
      setNotice(
        "Prior claim released. Existing work is preserved. You can now start an agent.",
      );
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setTakingOver(false);
    }
  }
  return (
    <div
      className="execution-tracking"
      aria-label="Execution tracking"
      aria-busy={loading || takingOver}
    >
      <div className="execution-tracking-heading">
        <h4>Execution trace</h4>
        <button
          className="text-button"
          type="button"
          aria-label="Refresh execution trace"
          disabled={loading || takingOver}
          onClick={() => {
            setError("");
            setRevision((value) => value + 1);
          }}
        >
          <RefreshCw size={13} /> Refresh trace
        </button>
      </div>
      {loading && (
        <p role="status">Checking the runner and recorded session…</p>
      )}
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {notice && (
        <p className="success-notice" role="status">
          {notice}
        </p>
      )}
      {status && (
        <>
          <p>
            <strong>{trackingLabels[status.tracking]}</strong>
            {status.stale ? " · heartbeat stale" : ""}
          </p>
          <p>{status.reason}</p>
          {nativeUrl && (
            <a className="text-button" href={nativeUrl}>
              <ExternalLink size={13} /> Open in Codex
            </a>
          )}
          <dl className="execution-tracking-facts">
            {status.nativeSessionId && (
              <>
                <dt>Native thread ID</dt>
                <dd>{status.nativeSessionId}</dd>
              </>
            )}
            {status.sessionId && (
              <>
                <dt>Claim session</dt>
                <dd>{status.sessionId}</dd>
              </>
            )}
            {status.executionId && (
              <>
                <dt>Execution</dt>
                <dd>{status.executionId}</dd>
              </>
            )}
            <dt>Process</dt>
            <dd>
              {status.processAlive === true
                ? "Verified alive"
                : status.processAlive === false
                  ? "No live process verified"
                  : "Unknown; a prior process may still exist"}
            </dd>
            {status.lastHeartbeatAt && (
              <>
                <dt>Last heartbeat</dt>
                <dd title={status.lastHeartbeatAt}>
                  {timeAgo(status.lastHeartbeatAt)}
                </dd>
              </>
            )}
            {status.worktreePath && (
              <>
                <dt>Preserved worktree</dt>
                <dd>{status.worktreePath}</dd>
              </>
            )}
            {status.branch && (
              <>
                <dt>Branch</dt>
                <dd>{status.branch}</dd>
              </>
            )}
          </dl>
          {!!status.evidence?.length && (
            <ul className="execution-evidence">
              {status.evidence.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          )}
          {canTakeOver && !confirming && (
            <button
              type="button"
              className="button small-button"
              disabled={disabled || takingOver}
              onClick={() => {
                setConfirming(true);
                setAcknowledged(false);
              }}
            >
              Take over prior claim
            </button>
          )}
          {confirming && (
            <div className="takeover-confirmation">
              <p>
                Review the trace above. Takeover releases this recorded claim
                and preserves its branch, worktree and history. It does not stop
                an unknown process or start another agent.
              </p>
              <label>
                Takeover reason
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={reason}
                  disabled={takingOver || disabled}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  disabled={takingOver || disabled}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                I understand the prior process may still exist and will preserve
                its work.
              </label>
              {!canTakeOver && (
                <p className="warning-text">
                  Refresh and inspect the current trace before confirming. A
                  verified live claim cannot be taken over.
                </p>
              )}
              <div className="takeover-actions">
                <button
                  type="button"
                  className="button danger small-button"
                  disabled={
                    disabled ||
                    takingOver ||
                    !canTakeOver ||
                    !reason.trim() ||
                    !acknowledged
                  }
                  onClick={() => void takeOver()}
                >
                  {takingOver ? "Releasing claim…" : "Confirm takeover"}
                </button>
                <button
                  type="button"
                  className="button small-button"
                  disabled={takingOver}
                  onClick={() => setConfirming(false)}
                >
                  Cancel takeover
                </button>
              </div>
            </div>
          )}
          {!!status.history?.length && (
            <details className="execution-history">
              <summary>Execution history ({status.history.length})</summary>
              <ol>
                {status.history.map((item) => (
                  <li key={item.id}>
                    <strong>{item.state}</strong>
                    <p>{item.summary || "No summary recorded"}</p>
                    <span>{item.id}</span>
                    {item.nativeSessionId && (
                      <span>Native thread: {item.nativeSessionId}</span>
                    )}
                    <span>
                      Started {timeAgo(item.startedAt)}
                      {item.releasedAt
                        ? ` · released ${timeAgo(item.releasedAt)}`
                        : " · claim retained"}
                    </span>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}
    </div>
  );
}
