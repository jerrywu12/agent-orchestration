import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.mjs";
import { Service } from "../server/service.mjs";
import { buildTaskPacket } from "../server/task-packet.mjs";
function fixture(t) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const service = new Service(store);
  const project = service.createProject({
    name: "Synthetic planning",
    repo: "fixture/planning",
  });
  const stage = (role) =>
    store.list("stage", project.id).find((s) => s.role === role).id;
  const dependency = service.createTicket({
    projectId: project.id,
    title: "Prerequisite facts",
    ownerId: "claude",
    stageId: stage("planning"),
  });
  const reserved = service.claim(dependency.id, {
    agentId: "claude",
    sessionId: "foreign-planner",
  });
  const ticket = service.createTicket({
    projectId: project.id,
    title: "Resolve missing specification",
    ownerId: "codex",
    stageId: stage("planning"),
    blockedReason: "Acceptance requirements are missing",
    dependsOn: [dependency.id],
  });
  const execution = service.claim(ticket.id, {
    agentId: "codex",
    sessionId: "assigned-planner",
  });
  const identity = {
    agentId: "codex",
    executionId: execution.id,
    sessionId: execution.sessionId,
  };
  return {
    store,
    service,
    project,
    stage,
    ticket,
    dependency,
    reserved,
    execution,
    identity,
  };
}
test("planning packet directs proactive evidence-based blocker resolution before specification", (t) => {
  const { ticket, project, execution } = fixture(t);
  const packet = buildTaskPacket({
    ticket,
    project,
    execution,
    worktree: "/synthetic",
    managedClient: { node: "/node", path: "/helper", directory: "/mailbox" },
  });
  assert.match(
    packet,
    /first planning task is to investigate and resolve blockers/i,
  );
  assert.match(packet, /get_resolution_context before/i);
  assert.match(
    packet,
    /do not clear blockers or dependencies merely to make the ticket appear unblocked/i,
  );
  assert.match(packet, /do not take over another agent.s reservation/i);
  assert.match(
    packet,
    /does not authorize production implementation or Ready admission/,
  );
});
test("blocked Planning claim runs and assigned evidence-bearing updates can resolve its blocker", (t) => {
  const {
    store,
    service,
    ticket,
    dependency,
    reserved,
    execution,
    identity,
    stage,
  } = fixture(t);
  assert.equal(execution.purpose, "planning");
  assert.equal(store.get("ticket", ticket.id).stageId, stage("planning"));
  const context = service.resolutionContext(ticket.id, identity);
  assert.equal(context.dependencies[0].id, dependency.id);
  assert.equal(context.dependencies[0].execution.reserved, true);
  const updated = service.agentUpdate(ticket.id, {
    ...identity,
    version: ticket.version,
    reason:
      "Recorded missing acceptance requirements in specs/synthetic.md; prerequisite facts still awaited from assigned owner.",
    changes: { blockedReason: "" },
  });
  assert.equal(updated.blockedReason, "");
  assert.deepEqual(updated.dependsOn, [dependency.id]);
  assert.equal(store.active(dependency.id).id, reserved.id);
  assert.equal(store.active(ticket.id).id, execution.id);
  assert.ok(
    store
      .activities()
      .some(
        (a) =>
          a.ticketId === ticket.id &&
          a.summary.includes("Recorded missing acceptance requirements"),
      ),
  );
});
test("planner cannot clear foreign reservations or update without evidence", (t) => {
  const { store, service, ticket, dependency, reserved, identity } = fixture(t);
  assert.throws(
    () =>
      service.agentUpdate(ticket.id, {
        ...identity,
        version: ticket.version,
        reason: "",
        changes: { blockedReason: "" },
      }),
    /Evidence|reason/i,
  );
  assert.throws(
    () =>
      service.agentUpdate(dependency.id, {
        ...identity,
        version: dependency.version,
        reason: "Attempted foreign update",
        changes: { blockedReason: "" },
      }),
    /assigned|session/i,
  );
  assert.equal(store.active(dependency.id).id, reserved.id);
  assert.equal(
    store.get("ticket", ticket.id).blockedReason,
    "Acceptance requirements are missing",
  );
});
