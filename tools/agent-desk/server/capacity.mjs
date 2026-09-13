import { fail } from "./store.mjs";

// Only supervisor-owned children occupy managed slots. Retained claims still
// protect their ticket/scope, but do not reserve an entire provider.
export function managedCapacity(service, runner) {
  const limits = service.store
    .list("run-batch")
    .filter((batch) => batch.state === "running")
    .map((batch) => batch.concurrency)
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 4);
  const limit = Math.min(4, ...limits);
  const used = runner?.children?.size ?? 0;
  return {
    used,
    limit,
    full: used >= limit,
    reason: `Waiting for managed agent capacity (${used}/${limit} active).`,
  };
}

export function assertManagedCapacity(service, runner) {
  const capacity = managedCapacity(service, runner);
  if (capacity.full) fail(409, "CAPACITY_FULL", capacity.reason);
  return capacity;
}
