import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.mjs";
import { Service } from "../server/service.mjs";
function fixture(t) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const service = new Service(store);
  const project = service.createProject({
    name: "Lifecycle",
    repo: "fixture/lifecycle",
  });
  const stage = (role) =>
    store.list("stage", project.id).find((s) => s.role === role).id;
  const ticket = service.createTicket({
    projectId: project.id,
    title: "Synthetic leaf",
    ownerId: "codex",
    stageId: stage("ready"),
    brief: {
      specification: "spec.md",
      acceptanceCriteria: "Verified behavior",
      scope: "Fixture",
      verification: "Tests",
      allowedPaths: "fixture/**",
      conflictKeys: "none",
    },
  });
  const execution = service.claim(ticket.id, {
    agentId: "codex",
    sessionId: "lifecycle",
  });
  const report = (type, extra = {}) =>
    service.event(execution.id, {
      agentId: "codex",
      sessionId: execution.sessionId,
      eventId: "terminal",
      seq: 1,
      type,
      summary: "Retained synthetic work",
      ...extra,
    });
  return { store, service, project, ticket, execution, stage, report };
}
test("effective completion releases leaf into review once, never Done", (t) => {
  const { store, service, ticket, execution, stage, report } = fixture(t);
  const result = report("complete");
  assert.equal(result.state, "awaiting_review");
  assert.equal(store.get("ticket", ticket.id).stageId, stage("review"));
  assert.equal(store.active(ticket.id), null);
  const history = store.get("ticket", ticket.id).stageHistory;
  report("complete");
  assert.deepEqual(store.get("ticket", ticket.id).stageHistory, history);
});
test("Done supersedes resume state without changing checkpoint history", (t) => {
  const { store, service, ticket, execution, stage, report } = fixture(t);
  report("checkpoint");
  const checkpoint = store.execution(execution.id);
  const current = store.get("ticket", ticket.id);
  assert.ok(current.resumeReason);
  const done = service.updateTicket(ticket.id, {
    version: current.version,
    stageId: stage("done"),
  });
  assert.equal(done.resumeReason, "");
  assert.equal(store.get("ticket", ticket.id).resumeReason, "");
  assert.deepEqual(store.execution(execution.id), checkpoint);
  report("checkpoint");
  assert.equal(service.getTicket(ticket.id).resumeReason, "");
  assert.equal(store.get("ticket", ticket.id).stageId, stage("done"));
  const reopened = service.updateTicket(ticket.id, {
    version: done.version,
    stageId: stage("backlog"),
  });
  assert.equal(reopened.resumeReason, "");
  assert.equal(store.active(ticket.id), null);
});
test("legacy Done resume metadata is non-actionable on every read and after reopening", (t) => {
  const { store, service, ticket, execution, stage, report } = fixture(t);
  report("checkpoint");
  const current = store.get("ticket", ticket.id);
  const legacy = store.put(
    "ticket",
    { ...current, stageId: stage("done") },
    current.version,
  );
  const checkpoint = store.execution(execution.id);
  assert.ok(legacy.resumeReason);
  assert.equal(service.getTicket(ticket.id).resumeReason, "");
  assert.equal(
    service.state().tickets.find((t) => t.id === ticket.id).resumeReason,
    "",
  );
  assert.deepEqual(
    store.get("ticket", ticket.id),
    legacy,
    "reads do not rewrite historical data",
  );
  assert.deepEqual(store.execution(execution.id), checkpoint);
  const reopened = service.updateTicket(ticket.id, {
    version: legacy.version,
    stageId: stage("backlog"),
  });
  assert.equal(reopened.resumeReason, "");
  assert.deepEqual(store.execution(execution.id), checkpoint);
  assert.equal(store.active(ticket.id), null);
});
test("Done continues to refuse active claims without releasing them", (t) => {
  const { store, service, ticket, execution, stage, report } = fixture(t);
  const current = store.get("ticket", ticket.id);
  assert.throws(
    () =>
      service.updateTicket(ticket.id, {
        version: current.version,
        stageId: stage("done"),
      }),
    /Checkpoint or finish/,
  );
  assert.deepEqual(store.active(ticket.id), store.execution(execution.id));
  assert.deepEqual(store.get("ticket", ticket.id), current);
});
for (const type of ["checkpoint", "failed", "stopped"])
  test(`${type} moves active leaf to Backlog with retained-work reason`, (t) => {
    const { store, service, ticket, stage, report } = fixture(t);
    let current = store.get("ticket", ticket.id);
    service.updateTicket(ticket.id, {
      version: current.version,
      blockedReason: "Provider prerequisite remains",
    });
    report(type);
    current = store.get("ticket", ticket.id);
    assert.equal(current.stageId, stage("backlog"));
    assert.equal(current.blockedReason, "Provider prerequisite remains");
    assert.match(current.resumeReason, /retained|resume/i);
    assert.match(current.resumeReason, /Retained synthetic work/);
  });
test("managed complete with unresolved blockers checkpoints into Backlog", (t) => {
  const { store, service, ticket, execution, stage, report } = fixture(t);
  store.saveExecution({ ...execution, managedBy: "agent-desk" });
  const current = store.get("ticket", ticket.id);
  service.updateTicket(ticket.id, {
    version: current.version,
    blockedReason: "Still blocked",
  });
  assert.equal(report("complete").state, "checkpointed");
  assert.equal(store.get("ticket", ticket.id).stageId, stage("backlog"));
});
test("manually moved tickets and parent containers retain their stage", (t) => {
  const { store, service, project, ticket, stage, report } = fixture(t);
  service.createTicket({
    projectId: project.id,
    title: "Child",
    parentId: ticket.id,
  });
  report("checkpoint");
  assert.equal(store.get("ticket", ticket.id).stageId, stage("active"));
});
test("terminal report does not overwrite a manually moved stage", (t) => {
  const { store, service, ticket, stage, report } = fixture(t);
  const current = store.get("ticket", ticket.id);
  service.updateTicket(ticket.id, {
    version: current.version,
    stageId: stage("review"),
  });
  report("checkpoint");
  assert.equal(store.get("ticket", ticket.id).stageId, stage("review"));
});
test("foreign terminal report cannot change stage or release claim", (t) => {
  const { store, ticket, execution, stage, report } = fixture(t);
  assert.throws(
    () => report("complete", { sessionId: "foreign" }),
    /different agent or session/,
  );
  assert.equal(store.get("ticket", ticket.id).stageId, stage("active"));
  assert.equal(store.active(ticket.id).id, execution.id);
});
test("explicit external reconciliation releases into Backlog but cannot rewrite a newer claim", (t) => {
  const { store, service, ticket, execution, stage } = fixture(t);
  store.saveExecution({ ...execution, external: true });
  const old = service.reconcileExternal(execution.id, {
    sessionId: execution.sessionId,
    stopped: true,
    summary: "Original client stopped",
  });
  assert.equal(store.get("ticket", ticket.id).stageId, stage("backlog"));
  const current = store.get("ticket", ticket.id);
  service.updateTicket(
    ticket.id,
    { version: current.version, stageId: stage("ready") },
    { confirmedTransition: true },
  );
  const newer = service.claim(ticket.id, {
    agentId: "codex",
    sessionId: "newer",
  });
  const history = store.get("ticket", ticket.id).stageHistory;
  assert.throws(
    () =>
      service.reconcileExternal(execution.id, {
        sessionId: execution.sessionId,
        stopped: true,
        summary: "Old replay",
      }),
    /released|finished/,
  );
  assert.equal(store.active(ticket.id).id, newer.id);
  assert.equal(store.get("ticket", ticket.id).stageId, stage("active"));
  assert.deepEqual(store.get("ticket", ticket.id).stageHistory, history);
});
test("partial external reconciliation retains stage and reservation until every session resolves", (t) => {
  const { store, service, ticket, execution, stage } = fixture(t);
  store.saveExecution({
    ...execution,
    external: true,
    heldSessions: [{ sessionId: "held", releasedAt: null }],
  });
  service.reconcileExternal(execution.id, {
    sessionId: execution.sessionId,
    stopped: true,
    summary: "Primary stopped",
  });
  assert.equal(store.get("ticket", ticket.id).stageId, stage("active"));
  assert.ok(store.active(ticket.id));
  service.reconcileExternal(execution.id, {
    sessionId: "held",
    stopped: true,
    summary: "Held stopped",
  });
  assert.equal(store.get("ticket", ticket.id).stageId, stage("backlog"));
});
test("new implementation clears resume reason and terminal failure rolls back as one transaction", (t) => {
  const { store, service, ticket, stage, report } = fixture(t);
  report("checkpoint");
  let current = store.get("ticket", ticket.id);
  service.updateTicket(
    ticket.id,
    { version: current.version, stageId: stage("ready") },
    { confirmedTransition: true },
  );
  const execution = service.claim(ticket.id, {
    agentId: "codex",
    sessionId: "resumed",
  });
  assert.equal(store.get("ticket", ticket.id).resumeReason, "");
  const history = store.get("ticket", ticket.id).stageHistory;
  const original = service.updateTicket;
  service.updateTicket = () => {
    throw Error("injected persistence failure");
  };
  assert.throws(
    () =>
      service.event(execution.id, {
        agentId: "codex",
        sessionId: execution.sessionId,
        eventId: "failed-transition",
        seq: 1,
        type: "complete",
        summary: "Complete",
      }),
    /injected/,
  );
  service.updateTicket = original;
  assert.equal(store.active(ticket.id).id, execution.id);
  assert.deepEqual(store.get("ticket", ticket.id).stageHistory, history);
  assert.equal(
    store.db
      .prepare("SELECT COUNT(*) AS count FROM events WHERE execution_id=?")
      .get(execution.id).count,
    0,
  );
});
test("historical lifecycle helper cannot move work after a newer reservation", (t) => {
  const { store, service, ticket, stage, report } = fixture(t);
  const old = report("checkpoint");
  const current = store.get("ticket", ticket.id);
  service.updateTicket(
    ticket.id,
    { version: current.version, stageId: stage("ready") },
    { confirmedTransition: true },
  );
  const newer = service.claim(ticket.id, {
    agentId: "codex",
    sessionId: "new",
  });
  service.settleExecutionStage(old, "checkpoint");
  assert.equal(store.active(ticket.id).id, newer.id);
  assert.equal(store.get("ticket", ticket.id).stageId, stage("active"));
});
