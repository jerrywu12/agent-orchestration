import type { RunResult } from "../bulk-types";

export function timestamp(value?: string | null): number | null {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
function duration(milliseconds: number) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
function age(value: string | null | undefined, now: number) {
  const at = timestamp(value);
  return at === null ? "Unknown" : `${duration(now - at)} ago`;
}
function isWorking(result: RunResult) {
  return (
    ["running", "already_running"].includes(result.status) &&
    !result.telemetry?.releasedAt
  );
}
export function heartbeatStale(result: RunResult, now: number) {
  if (!isWorking(result) || !result.telemetry) return false;
  const heartbeat = timestamp(result.telemetry.heartbeatAt);
  return (
    result.telemetry.stale || heartbeat === null || now - heartbeat > 90000
  );
}
export function runCounts(results: RunResult[], now: number) {
  return results.reduce(
    (counts, row) => {
      if (row.status === "queued") counts.queued++;
      else if (
        ["needs_takeover", "failed", "skipped"].includes(row.status) ||
        heartbeatStale(row, now)
      )
        counts.attention++;
      else if (isWorking(row)) counts.working++;
      else counts.finished++;
      return counts;
    },
    { queued: 0, working: 0, attention: 0, finished: 0 },
  );
}

export function RunProgress({
  result,
  ticketKey,
  now,
  paused,
}: {
  result: RunResult;
  ticketKey: string;
  now: number;
  paused: boolean;
}) {
  if (result.status === "queued" || (!result.telemetry && !result.executionId))
    return null;
  const telemetry = result.telemetry;
  const working = isWorking(result);
  const stale = heartbeatStale(result, now);
  const value = telemetry?.progress;
  const percent =
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
      ? value
      : null;
  const startedAt = timestamp(telemetry?.startedAt);
  const releasedAt = timestamp(telemetry?.releasedAt);
  const elapsed =
    startedAt === null || (!working && releasedAt === null)
      ? "Unknown"
      : duration((releasedAt ?? now) - startedAt);
  return (
    <div
      className={`run-progress ${paused || stale ? "run-progress-paused" : ""}`}
      role="group"
      aria-label={`Progress for ${ticketKey}`}
    >
      <div className="run-progress-meter">
        {percent !== null ? (
          <>
            <span>
              {working
                ? `${percent}% reported`
                : `Last reported progress: ${percent}%`}
            </span>
            <progress
              max={100}
              value={percent}
              aria-label={`Reported progress for ${ticketKey}`}
            />
          </>
        ) : working ? (
          <>
            <span>
              {stale
                ? "Progress unknown"
                : paused
                  ? "Last report had no percentage"
                  : "Working · no percentage reported"}
            </span>
            <span
              className="run-progress-indeterminate"
              role="progressbar"
              aria-label={`Execution activity for ${ticketKey}`}
              aria-valuetext="No percentage reported"
            >
              <span />
            </span>
          </>
        ) : (
          <span>No percentage reported</span>
        )}
      </div>
      {stale && (
        <p className="run-progress-warning">
          No recent heartbeat · inspect this execution
        </p>
      )}
      <dl className="run-progress-facts">
        <div>
          <dt>Elapsed</dt>
          <dd>{elapsed}</dd>
        </div>
        <div>
          <dt>Last heartbeat</dt>
          <dd title={telemetry?.heartbeatAt || undefined}>
            {!working && timestamp(telemetry?.heartbeatAt) !== null ? (
              <time dateTime={telemetry?.heartbeatAt || undefined}>
                {new Date(telemetry!.heartbeatAt!).toLocaleString()}
              </time>
            ) : (
              age(telemetry?.heartbeatAt, now)
            )}
          </dd>
        </div>
        <div>
          <dt>Latest activity</dt>
          <dd title={telemetry?.lastActivityAt || undefined}>
            {!working && timestamp(telemetry?.lastActivityAt) !== null ? (
              <time dateTime={telemetry?.lastActivityAt || undefined}>
                {new Date(telemetry!.lastActivityAt!).toLocaleString()}
              </time>
            ) : (
              age(telemetry?.lastActivityAt, now)
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}
