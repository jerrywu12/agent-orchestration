import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.mjs";
import { Service } from "../server/service.mjs";
import { Runner } from "../server/runner.mjs";

const brief = {
  specification: "spec.md",
  acceptanceCriteria: "Agent reports a reviewed result",
  scope: "One isolated task",
  verification: "Run focused checks",
  allowedPaths: "src/tracking/**",
  conflictKeys: "none",
};

function fixture(t) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const service = new Service(store);
  const project = service.createProject({ name: "Tracking fixture", path: process.cwd() });
  const stage = (role) => store.list("stage", project.id).find((item) => item.role === role).id;
  const ticket = service.createTicket({
    projectId: project.id,
    title: "Agent-owned task",
    ownerId: "codex",
    stageId: stage("backlog"),
    brief,
  });
  let starts = 0;
  service.runner = {
    availability: () => [{ id: "codex", available: false, reason: "CLI unavailable" }],
    start: () => { starts++; throw Error("A stage change must not start an agent"); },
  };
  return { store, service, stage, ticket, starts: () => starts };
}

test("confirmed Backlog to Planning records owner and stage without dispatch", (t) => {
  const f = fixture(t);
  const moved = f.service.transition(f.ticket.id, {
    version: f.ticket.version,
    stageId: f.stage("planning"),
    ownerId: "codex",
    confirmed: true,
  });
  assert.equal(moved.outcome, "moved");
  assert.equal(moved.ticket.stageId, f.stage("planning"));
  assert.equal(moved.ticket.ownerId, "codex");
  assert.equal(moved.ticket.execution, null);
  assert.equal(moved.ticket.launchIntent, null);
  assert.equal(f.starts(), 0);
  assert.throws(() => f.service.transition(f.ticket.id, {
    version: f.ticket.version,
    stageId: f.stage("planning"),
    ownerId: "codex",
    confirmed: true,
  }), /changed/i);
});

test("independent agent reports planning and implementation stage changes", (t) => {
  const f = fixture(t);
  f.service.transition(f.ticket.id, {
    version: f.ticket.version,
    stageId: f.stage("planning"),
    ownerId: "codex",
    confirmed: true,
  });
  const plan = f.service.claim(f.ticket.id, { agentId: "codex", sessionId: "native-plan" });
  f.service.event(plan.id, {
    agentId: "codex", sessionId: "native-plan", eventId: "plan-progress", seq: 1,
    type: "progress", summary: "Specification reviewed", progress: 50,
  });
  assert.equal(f.service.getTicket(f.ticket.id).execution.summary, "Specification reviewed");
  f.service.event(plan.id, {
    agentId: "codex", sessionId: "native-plan", eventId: "plan-complete", seq: 2,
    type: "complete", summary: "Planning complete",
  });
  assert.equal(f.service.getTicket(f.ticket.id).stageId, f.stage("ready"));
  assert.equal(f.starts(), 0);
  const build = f.service.claim(f.ticket.id, { agentId: "codex", sessionId: "native-build" });
  assert.equal(f.service.getTicket(f.ticket.id).stageId, f.stage("active"));
  f.service.event(build.id, {
    agentId: "codex", sessionId: "native-build", eventId: "build-complete", seq: 1,
    type: "complete", summary: "Implementation ready for review",
  });
  assert.equal(f.service.getTicket(f.ticket.id).stageId, f.stage("review"));
  assert.equal(f.starts(), 0);
});

test("restart retires legacy queued admissions without touching prior executions", (t) => {
  const f = fixture(t);
  for (const status of ["queued", "awaiting_claim"]) {
    f.store.put("launch-intent", {
      id: f.ticket.id, ticketId: f.ticket.id, ownerId: "codex",
      stageId: f.stage("planning"), purpose: "planning", confirmed: true,
      status, createdAt: new Date().toISOString(),
    });
    new Service(f.store);
    const intent = f.store.get("launch-intent", f.ticket.id);
    assert.equal(intent.status, "cancelled");
    assert.match(intent.reason, /without launching/);
  }
  assert.equal(f.starts(), 0);
});

test("direct and batch launch entry points refuse work in tracking-only mode", (t) => {
  const f = fixture(t);
  const runner = new Runner(f.service, { dataDir: "/tmp/agent-desk-tracking-test", url: "http://127.0.0.1:1" });
  t.after(() => runner.coordinator.close());
  assert.throws(() => runner.start(f.ticket.id), (error) => error.code === "TRACKING_ONLY" && error.status === 410);
  assert.throws(() => runner.coordinator.submit({ ticketIds: [f.ticket.id], concurrency: 1, requestId: "tracking-only-1" }), (error) => error.code === "TRACKING_ONLY" && error.status === 410);
  assert.equal(f.store.active(f.ticket.id), null);
  assert.equal(f.store.list("run-batch").length, 0);
});
