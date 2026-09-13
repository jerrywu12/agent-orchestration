import { fail, now } from "./store.mjs";
import { traceExecution } from "./session-trace.mjs";

const stale = (e) =>
  !!e &&
  !e.releasedAt &&
  (!Number.isFinite(Date.parse(e.heartbeatAt)) ||
    Date.now() - Date.parse(e.heartbeatAt) > 90000);
const ids = (value) => {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 100 ||
    value.some((x) => typeof x !== "string" || !x || x.length > 300)
  )
    fail(422, "VALIDATION", "Select between 1 and 100 tickets.");
  return [...new Set(value)];
};
const boundedReason = (value) => {
  if (typeof value !== "string" || !value.trim() || value.length > 2000)
    fail(422, "VALIDATION", "Give a reason for taking over this session.");
  return value.trim();
};
export class RunCoordinator {
  constructor(service, runner, { trace = traceExecution } = {}) {
    this.service = service;
    this.runner = runner;
    this.trace = trace;
    this.closed = false;
    this.scheduled = false;
    for (const batch of service.store
      .list("run-batch")
      .filter((b) => b.state === "running")) {
      service.store.put("run-batch", {
        ...batch,
        state: "complete",
        results: batch.results.map((row) =>
          ["queued", "running"].includes(row.status)
            ? {
                ...row,
                status: "failed",
                message:
                  "Supervisor restarted. Inspect the retained execution before running again.",
              }
            : row,
        ),
      });
    }
    this.onChange = () => this.schedule();
    service.on("change", this.onChange);
  }
  close() {
    this.closed = true;
    this.service.off("change", this.onChange);
  }
  async status(ticketId) {
    this.service.require("ticket", ticketId);
    const execution =
      this.service.store.active(ticketId) ??
      this.service.store.latest(ticketId);
    const history = this.service.store.db
      .prepare(
        "SELECT data FROM executions WHERE ticket_id=? ORDER BY rowid DESC LIMIT 20",
      )
      .all(ticketId)
      .map((r) => {
        const e = JSON.parse(r.data);
        return Object.fromEntries(
          [
            "id",
            "state",
            "summary",
            "startedAt",
            "releasedAt",
            "nativeSessionId",
            "worktreePath",
            "branch",
            "recoveryReason",
          ].map((k) => [k, e[k] ?? null]),
        );
      });
    if (!execution)
      return {
        ticketId,
        executionId: null,
        sessionId: null,
        tracking: "none",
        state: "idle",
        processAlive: null,
        nativeSessionId: null,
        nativeThreadUrl: null,
        stale: false,
        canTakeOver: false,
        reason: "No execution has been started.",
        evidence: [],
        history,
      };
    const traced = await this.trace(execution, {
      children: this.runner.children,
    });
    const isStale = stale(execution);
    return {
      ...traced,
      ticketId,
      executionId: execution.id,
      sessionId: execution.sessionId,
      state: execution.state,
      stale: isStale,
      canTakeOver:
        isStale &&
        traced.processAlive !== true &&
        traced.tracking !== "managed" &&
        traced.tracking !== "process",
      worktreePath: execution.worktreePath,
      branch: execution.branch,
      lastHeartbeatAt: execution.heartbeatAt,
      history,
    };
  }
  async takeover(ticketId, input) {
    if (input.confirmed !== true)
      fail(
        422,
        "CONFIRM_REQUIRED",
        "Confirm that the old process may still exist and its saved work must be preserved.",
      );
    const reason = boundedReason(input.reason);
    const snapshot = await this.status(ticketId);
    if (!snapshot.canTakeOver)
      fail(
        409,
        "SESSION_TRACKED",
        "A running or recently reporting execution cannot be taken over. Stop its tracked process first.",
      );
    this.service.store.transaction(() => {
      const e = this.service.store.active(ticketId);
      if (
        !e ||
        e.id !== input.executionId ||
        e.sessionId !== input.sessionId ||
        e.heartbeatAt !== input.expectedHeartbeatAt ||
        e.heartbeatAt !== snapshot.lastHeartbeatAt ||
        !stale(e)
      )
        fail(
          409,
          "EXECUTION_CHANGED",
          "The execution changed during inspection. Trace it again before takeover.",
        );
      if (this.runner.children.has(e.id))
        fail(
          409,
          "SESSION_TRACKED",
          "This supervisor still owns a live process.",
        );
      const releasedAt = now();
      const result = this.service.store.saveExecution({
        ...e,
        state: "revoked",
        releasedAt,
        revokedAt: releasedAt,
        recoveryReason: reason,
        recoveryEvidence: snapshot.evidence,
        summary: `Administrator revoked the untraceable stale claim. Previous process was not stopped. ${reason}`,
        heldSessions: (e.heldSessions ?? []).map((s) =>
          s.releasedAt ? s : { ...s, state: "revoked", releasedAt },
        ),
      });
      this.service.store.activity(ticketId, "claim_revoked", result.summary);
      this.service.changed();
      return {
        ticketId,
        executionId: result.id,
        state: result.state,
        releasedAt,
        reason:
          "Old claim revoked; saved work and session history retained. Run Agent to start a new resolution pass.",
      };
    });
    return this.status(ticketId);
  }
  archive(input) {
    const ticketIds = ids(input.ticketIds);
    const results = ticketIds.map((ticketId) => {
      try {
        const t = this.service.require("ticket", ticketId);
        if (t.archived)
          return { ticketId, status: "skipped", message: "Already archived." };
        this.service.updateTicket(ticketId, {
          version: t.version,
          archived: true,
        });
        return { ticketId, status: "archived", message: "Archived." };
      } catch (e) {
        return {
          ticketId,
          status: "failed",
          message: e.status ? e.message : "Unable to archive this ticket.",
        };
      }
    });
    return { results };
  }
  get(batchId) {
    const batch =
      this.service.store.get("run-batch", batchId) ??
      fail(404, "NOT_FOUND", "Run batch not found.");
    // Dispatch records are durable queue outcomes. Progress belongs to the
    // exact execution they started or observed, not the ticket's latest run.
    const results = batch.results.map((row) => {
      if (!row.executionId) return row;
      const e = this.service.store.execution(row.executionId);
      if (!e || e.ticketId !== row.ticketId)
        return {
          ...row,
          status: "failed",
          message:
            "Execution record is unavailable. Open the ticket to inspect its history.",
        };
      const timestamp = (value) =>
        typeof value === "string" &&
        value.length <= 100 &&
        Number.isFinite(Date.parse(value))
          ? value
          : null;
      const telemetry = {
        state: e.state,
        summary: typeof e.summary === "string" ? e.summary.slice(0, 4000) : "",
        progress:
          Number.isFinite(e.progress) && e.progress >= 0 && e.progress <= 100
            ? e.progress
            : null,
        startedAt: timestamp(e.startedAt),
        heartbeatAt: timestamp(e.heartbeatAt),
        lastActivityAt: timestamp(e.lastActivityAt),
        releasedAt: timestamp(e.releasedAt),
        reportingReadyAt: timestamp(e.reportingReadyAt),
        stale: stale(e),
      };
      if (!["running", "already_running"].includes(row.status))
        return { ...row, telemetry };
      const status = !e.releasedAt
        ? row.status
        : e.state === "awaiting_review"
          ? "awaiting_review"
          : e.state === "checkpointed"
            ? "checkpointed"
            : "failed";
      return {
        ...row,
        status,
        message: telemetry.summary || row.message,
        telemetry,
      };
    });
    return {
      ...batch,
      results,
      observedAt: now(),
      state: results.some((row) =>
        ["queued", "running", "already_running"].includes(row.status),
      )
        ? "running"
        : "complete",
    };
  }
  submit(input) {
    const ticketIds = ids(input.ticketIds),
      concurrency = input.concurrency ?? 2;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4)
      fail(422, "VALIDATION", "Concurrency must be between 1 and 4.");
    const requestId = input.requestId;
    if (
      typeof requestId !== "string" ||
      !/^[a-zA-Z0-9-]{8,100}$/.test(requestId)
    )
      fail(422, "VALIDATION", "A stable request ID is required.");
    const prior = this.service.store.get("run-batch", requestId);
    if (prior) {
      if (
        JSON.stringify(prior.ticketIds) !== JSON.stringify(ticketIds) ||
        prior.concurrency !== concurrency
      )
        fail(
          409,
          "REQUEST_CONFLICT",
          "This request ID was used for a different selection.",
        );
      return this.get(prior.id);
    }
    const batch = this.service.store.put("run-batch", {
      id: requestId,
      createdAt: now(),
      state: "running",
      concurrency,
      ticketIds,
      results: ticketIds.map((ticketId) => ({
        ticketId,
        status: "queued",
        message: "Waiting for an agent slot.",
      })),
    });
    this.schedule();
    return this.get(batch.id);
  }
  schedule() {
    if (this.closed || this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      if (this.closed) return;
      this.drain();
    });
  }
  drain() {
    const batches = this.service.store
      .list("run-batch")
      .filter((b) => b.state === "running");
    const limit = Math.min(4, ...batches.map((b) => b.concurrency));
    for (const batch of batches) {
      const before = JSON.stringify(batch.results);
      for (const row of batch.results) {
        if (row.status === "running") {
          const e = this.service.store.execution(row.executionId);
          if (e?.releasedAt) {
            row.status =
              e.state === "awaiting_review"
                ? "awaiting_review"
                : e.state === "checkpointed"
                  ? "checkpointed"
                  : "failed";
            row.message = e.summary || "Execution finished.";
          }
          continue;
        }
        if (row.status !== "queued") continue;
        try {
          const t = this.service.require("ticket", row.ticketId),
            e = this.service.store.active(t.id);
          if (e) {
            row.executionId = e.id;
            row.status =
              stale(e) || e.state === "interrupted"
                ? "needs_takeover"
                : "already_running";
            row.message =
              row.status === "needs_takeover"
                ? "Trace this reserved session and explicitly take over if it cannot be found."
                : "This ticket already has an active execution.";
            continue;
          }
          if (
            t.archived ||
            this.service.require("stage", t.stageId).role === "done"
          ) {
            row.status = "skipped";
            row.message =
              "Archived or completed ticket; reopen it before running.";
            continue;
          }
          if (this.runner.children.size >= limit) continue;
          const run = this.runner.start(t.id);
          row.executionId = run.id;
          row.status = "running";
          row.message =
            run.purpose === "resolve_blockers"
              ? "Resolving blockers and dependencies."
              : "Agent started.";
        } catch (e) {
          row.status = "failed";
          row.message = e.status
            ? e.message
            : "Dispatch failed; inspect the retained execution.";
        }
      }
      const state = batch.results.some((r) =>
        ["queued", "running"].includes(r.status),
      )
        ? "running"
        : "complete";
      if (before !== JSON.stringify(batch.results) || state !== batch.state) {
        this.service.store.put("run-batch", { ...batch, state });
        this.service.changed();
      }
    }
  }
}
