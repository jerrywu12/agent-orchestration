import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Clock3,
  Moon,
  RefreshCw,
  Terminal,
} from "lucide-react";
import { api, errorMessage } from "../api";
import type {
  ActivitySnapshot,
  ActiveTask,
  ActiveWorker,
  SleepHolder,
} from "../activity-types";

const ACTIVITY_POLL_INTERVAL = 15000;

export function formatElapsed(seconds: number): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
    return "0s";
  }
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export function AgentActivity() {
  const [snapshot, setSnapshot] = useState<ActivitySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>("");
  const mounted = useRef(false);
  const inFlight = useRef(false);

  const fetchActivity = useCallback(async (isRefresh = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (isRefresh) {
      setRefreshing(true);
    }
    setError("");
    try {
      let data: ActivitySnapshot;
      if (isRefresh) {
        data = await api<ActivitySnapshot>("/activity/refresh", "POST");
      } else {
        data = await api<ActivitySnapshot>("/activity");
      }
      if (mounted.current) {
        setSnapshot(data);
        setError("");
      }
    } catch (err) {
      if (mounted.current) {
        setError(errorMessage(err));
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setLoading(false);
        if (isRefresh) {
          setRefreshing(false);
        }
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void fetchActivity(false);

    const interval = window.setInterval(() => {
      if (!document.hidden && !inFlight.current) {
        void fetchActivity(false);
      }
    }, ACTIVITY_POLL_INTERVAL);

    const onVisible = () => {
      if (!document.hidden && !inFlight.current) {
        void fetchActivity(false);
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      mounted.current = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchActivity]);

  const handleRefresh = () => {
    void fetchActivity(true);
  };

  if (loading && !snapshot) {
    return (
      <section
        className="activity-section activity-loading"
        aria-label="Agent activity"
        aria-busy="true"
      >
        <div className="activity-loading-indicator">
          <RefreshCw size={16} className="spin" />
          <span>Loading agent activity…</span>
        </div>
      </section>
    );
  }

  if (error && !snapshot) {
    return (
      <section
        className="activity-section activity-error"
        aria-label="Agent activity"
        role="alert"
      >
        <div className="activity-error-content">
          <AlertCircle size={16} />
          <div>
            <strong>Unable to load agent activity</strong>
            <p>{error}</p>
          </div>
          <button
            className="button"
            onClick={() => void fetchActivity(false)}
            aria-label="Retry loading activity"
          >
            <RefreshCw size={13} />
            Retry
          </button>
        </div>
      </section>
    );
  }

  if (!snapshot) return null;

  const isSpinning = refreshing || snapshot.refreshing;

  return (
    <section
      className="activity-section"
      aria-label="Agent activity"
      data-activity-state={snapshot.state}
      data-activity-stale={snapshot.stale ? "true" : "false"}
      data-activity-partial={snapshot.partial ? "true" : "false"}
    >
      <header className="activity-header">
        <div className="activity-header-title">
          <div className="activity-title-row">
            <h2>
              <Activity size={16} />
              Agent activity
            </h2>
            <span
              className={`activity-badge activity-badge-${snapshot.state}`}
              data-testid="activity-count"
            >
              {snapshot.state === "unobservable" && snapshot.activeCount === 0
                ? "Unavailable"
                : `${snapshot.activeCount} active`}
            </span>
          </div>
          <p className="activity-subtitle">
            Background AI tasks and worker processes in flight on this Mac.
          </p>
        </div>
        <div className="activity-header-actions">
          {snapshot.observedAt && (
            <span
              className={`activity-timestamp ${snapshot.stale ? "activity-stale-text" : ""}`}
              title={snapshot.observedAt}
            >
              <Clock3 size={12} />
              {new Date(snapshot.observedAt).toLocaleTimeString()}
            </span>
          )}
          <button
            className="button"
            aria-label="Refresh activity"
            disabled={isSpinning}
            onClick={handleRefresh}
          >
            <RefreshCw size={13} className={isSpinning ? "spin" : ""} />
            {isSpinning ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {/* Indicators for stale, partial, and truncated state */}
      {snapshot.stale && (
        <div
          className="activity-banner activity-banner-stale"
          role="status"
          data-activity-stale="true"
          data-testid="activity-stale"
        >
          <AlertTriangle size={14} />
          <div>
            <strong>Observation is stale</strong>
            <span>
              Observation timed out or failed. Displaying retained prior sample.
            </span>
          </div>
        </div>
      )}

      {snapshot.partial && (
        <div
          className="activity-banner activity-banner-partial"
          role="status"
          data-activity-partial="true"
          data-testid="activity-partial"
        >
          <AlertCircle size={14} />
          <div>
            <strong>Partial source coverage</strong>
            <span>One or more activity sources could not be observed.</span>
          </div>
        </div>
      )}

      {snapshot.truncated && (
        <div
          className="activity-banner activity-banner-truncated"
          role="status"
          data-activity-truncated="true"
          data-testid="activity-truncated"
        >
          <AlertTriangle size={14} />
          <div>
            <strong>Display limit reached</strong>
            <span>Some active items exceeded bounds and were omitted.</span>
          </div>
        </div>
      )}

      {error && (
        <div className="activity-banner activity-banner-error" role="alert">
          <AlertCircle size={14} />
          <div>
            <strong>Refresh error</strong>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Three distinct structural DOM states */}
      {snapshot.state === "idle" && (
        <div
          className="activity-empty-state"
          data-activity-state="idle"
          data-testid="activity-idle"
        >
          <div className="activity-empty-icon">
            <Activity size={24} />
          </div>
          <div className="activity-empty-text">
            <strong>No active agent tasks or background workers</strong>
            <p>
              All observed sources report zero AI agent activity in flight.
            </p>
          </div>
        </div>
      )}

      {snapshot.state === "unobservable" && (
        <div
          className="activity-unobservable-state"
          data-activity-state="unobservable"
          data-testid="activity-unobservable"
        >
          <div className="activity-unobservable-header">
            <AlertTriangle size={20} />
            <div>
              <strong>Activity cannot be confirmed</strong>
              <p>
                One or more activity sources failed to respond or could not be
                read. Work may be running unobserved.
              </p>
            </div>
          </div>
          {snapshot.sources.some((s) => s.status === "unobservable") && (
            <ul
              className="activity-unobservable-reasons"
              data-testid="activity-unobservable-reasons"
            >
              {snapshot.sources
                .filter((s) => s.status === "unobservable")
                .map((source) => (
                  <li key={source.id}>
                    <strong>{source.label}:</strong>{" "}
                    {source.reason || "Unobservable"}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      {/* Task table — rendered in active state or if fallback/partial tasks exist */}
      {snapshot.tasks.length > 0 && (
        <div
          className="activity-table-container"
          data-testid="activity-tasks"
        >
          <div className="activity-table-title">
            <h3>Active tasks ({snapshot.tasks.length})</h3>
            <span className="activity-table-hint">
              Codex threads with active task lifecycle
            </span>
          </div>
          <div className="machine-table-wrap">
            <table className="machine-data-table activity-tasks-table">
              <caption className="sr-only">Active agent tasks</caption>
              <thead>
                <tr>
                  <th scope="col">ID</th>
                  <th scope="col">Origin</th>
                  <th scope="col">Description</th>
                  <th scope="col">Workspace</th>
                  <th scope="col">Lifecycle</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.tasks.map((task: ActiveTask) => (
                  <tr key={task.id} data-testid={`activity-task-${task.id}`}>
                    <td data-label="ID">
                      <code className="activity-id-tag">{task.id}</code>
                    </td>
                    <td data-label="Origin">
                      <span className="activity-origin-tag">{task.origin}</span>
                    </td>
                    <td data-label="Description">
                      <span className="activity-description-text">
                        {task.description}
                      </span>
                    </td>
                    <td data-label="Workspace">
                      <span className="activity-workspace-tag">
                        {task.workspace}
                      </span>
                    </td>
                    <td data-label="Lifecycle">
                      <span
                        className={`activity-lifecycle-tag lifecycle-${task.lifecycle}`}
                      >
                        {task.lifecycle}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Worker table — rendered in active state or if processes exist */}
      {snapshot.workers.length > 0 && (
        <div
          className="activity-table-container"
          data-testid="activity-workers"
        >
          <div className="activity-table-title">
            <h3>Active workers ({snapshot.workers.length})</h3>
            <span className="activity-table-hint">
              Background agent processes
            </span>
          </div>
          <div className="machine-table-wrap">
            <table className="machine-data-table activity-workers-table">
              <caption className="sr-only">Active agent workers</caption>
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col">PID</th>
                  <th scope="col">Elapsed runtime</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.workers.map((worker: ActiveWorker) => (
                  <tr
                    key={worker.pid}
                    data-testid={`activity-worker-${worker.pid}`}
                  >
                    <td data-label="Agent">
                      <span className="activity-agent-name">
                        <Terminal size={14} />
                        <strong>{worker.agentName}</strong>
                      </span>
                    </td>
                    <td data-label="PID">
                      <code>{worker.pid}</code>
                    </td>
                    <td data-label="Elapsed runtime">
                      <span className="activity-elapsed-badge">
                        {formatElapsed(worker.elapsedSeconds)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sleep-prevention status */}
      {snapshot.sleepPrevention && (
        <div
          className={`activity-sleep-prevention state-${snapshot.sleepPrevention.state}`}
          data-testid="activity-sleep-prevention"
          data-sleep-state={snapshot.sleepPrevention.state}
        >
          <div className="activity-sleep-header">
            <Moon size={14} />
            <span>
              Sleep prevention:{" "}
              <strong data-testid="activity-sleep-state">
                {snapshot.sleepPrevention.state}
              </strong>
            </span>
            {snapshot.sleepPrevention.state === "active" &&
              snapshot.sleepPrevention.holders.length > 0 && (
                <span
                  className="activity-sleep-count"
                  data-testid="activity-sleep-count"
                >
                  ({snapshot.sleepPrevention.holders.length}{" "}
                  {snapshot.sleepPrevention.holders.length === 1
                    ? "holder"
                    : "holders"}
                  )
                </span>
              )}
          </div>
          {snapshot.sleepPrevention.state === "active" &&
            snapshot.sleepPrevention.holders.length > 0 && (
              <ul
                className="activity-sleep-holders"
                data-testid="activity-sleep-holders"
              >
                {snapshot.sleepPrevention.holders.map((holder: SleepHolder) => (
                  <li
                    key={holder.pid}
                    data-testid={`activity-sleep-holder-${holder.pid}`}
                  >
                    PID <code className="activity-holder-pid">{holder.pid}</code> ·{" "}
                    <span className="activity-holder-elapsed">
                      {formatElapsed(holder.elapsedSeconds)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}

      {/* Advisory notes */}
      {snapshot.notes.length > 0 && (
        <ul className="activity-notes" data-testid="activity-notes">
          {snapshot.notes.map((note, idx) => (
            <li key={idx}>{note}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
