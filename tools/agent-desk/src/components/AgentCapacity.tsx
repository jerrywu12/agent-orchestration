import { Clock3 } from "lucide-react";
import type { AgentCapacity as Capacity } from "../types";

const statusLabel: Record<Capacity["status"], string> = {
  available: "Capacity available",
  limited: "Capacity limited",
  auth_required: "Sign-in required",
  unavailable: "Limits unavailable",
  unknown: "Capacity unknown",
};
function percent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value * 10) / 10
    : null;
}
function timestamp(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function AgentCapacity({
  capacity,
  name,
  loading,
  failed,
  now,
}: {
  capacity?: Capacity;
  name: string;
  loading: boolean;
  failed: boolean;
  now: number;
}) {
  const observed = timestamp(capacity?.observedAt);
  const stale =
    !!capacity &&
    (failed ||
      capacity.stale ||
      (!!observed && now - Date.parse(capacity.observedAt!) > 300000));
  return (
    <section
      className="agent-capacity"
      aria-label={`Provider capacity for ${name}`}
    >
      <div className="capacity-heading">
        <h4>Provider capacity</h4>
        <span
          className={`capacity-status capacity-${capacity?.status || "unknown"}`}
        >
          {capacity
            ? statusLabel[capacity.status]
            : loading
              ? "Checking limits…"
              : "Limits not observed"}
        </span>
        {stale && <span className="capacity-stale">Stale observation</span>}
      </div>
      <p className="capacity-message">
        {capacity?.message ||
          (loading
            ? "Reading passive provider observations."
            : "No provider limit observation is available.")}
      </p>
      {capacity?.ordinaryUsageAllowed === false && (
        <p className="capacity-permission">
          Provider permission: ordinary usage blocked.
        </p>
      )}
      {capacity?.windows.length ? (
        <ul className="capacity-windows">
          {capacity.windows.map((window) => {
            const used = percent(window.usedPercent);
            const remaining = percent(window.remainingPercent);
            const reset = timestamp(window.resetsAt);
            const expired = !!reset && Date.parse(window.resetsAt!) <= now;
            return (
              <li key={window.id}>
                <div className="capacity-window-usage">
                  <strong>{window.label}</strong>
                  <span>
                    {used === null ? "Usage not reported" : `${used}% used`}
                  </span>
                  <span className="muted">
                    {remaining === null
                      ? "Remaining not reported"
                      : `${remaining}% remaining`}
                  </span>
                  {used !== null && (
                    <meter
                      min={0}
                      max={100}
                      value={Math.max(0, Math.min(100, used))}
                      aria-label={`${window.label} usage`}
                    />
                  )}
                </div>
                <div className="capacity-reset">
                  <span>
                    <Clock3 size={12} />{" "}
                    {reset ? (
                      <>
                        Resets <time dateTime={window.resetsAt!}>{reset}</time>
                      </>
                    ) : (
                      "Reset not reported"
                    )}
                  </span>
                  {expired && (
                    <span className="capacity-expired">
                      Reset time passed; recovery not confirmed.
                    </span>
                  )}
                  {window.spendControlReached && (
                    <span>Provider spend control reached.</span>
                  )}
                  {window.rateLimitReachedType && (
                    <span>Provider limit: {window.rateLimitReachedType}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="capacity-provenance">
        <span>Source: {capacity?.source || "No observation"}</span>
        <span>
          {observed ? (
            <>
              Observed <time dateTime={capacity!.observedAt!}>{observed}</time>
            </>
          ) : (
            "Not observed"
          )}
        </span>
      </div>
    </section>
  );
}
