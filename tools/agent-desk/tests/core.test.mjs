import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";
import { Service } from "../server/service.mjs";
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "desk-test-"));
  const store = new Store(join(dir, "test.db"));
  const app = new Service(store);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const project = app.createProject({ name: "Research", key: "RES" });
  return { store, app, project };
}
const ticket = (app, project, extra = {}) =>
  app.createTicket({
    projectId: project.id,
    title: "Implement signal",
    ownerId: "codex",
    stageId: app
      .state()
      .stages.find((s) => s.projectId === project.id && s.role === "planning")
      .id,
    ...extra,
  });
test("ticket updates persist with custom stages and reject lost updates", (t) => {
  const { store, app, project } = fixture(t);
  const x = ticket(app, project);
  const stage = app.createStage({
    projectId: project.id,
    name: "Verification",
    role: "review",
  });
  const y = app.updateTicket(x.id, {
    version: x.version,
    stageId: stage.id,
    priority: "high",
  });
  assert.equal(y.priority, "high");
  assert.equal(store.get("ticket", x.id).stageId, stage.id);
  assert.throws(
    () => app.updateTicket(x.id, { version: x.version, title: "lost" }),
    (e) => e.status === 409,
  );
});
test("stage belongs to project and dependency cycles are rejected", (t) => {
  const { app, project } = fixture(t);
  const a = ticket(app, project);
  const b = ticket(app, project, { dependsOn: [a.id] });
  assert.throws(
    () => app.updateTicket(a.id, { version: a.version, dependsOn: [b.id] }),
    /cycle/i,
  );
  const p2 = app.createProject({ name: "Other" });
  assert.throws(
    () =>
      app.updateTicket(a.id, {
        version: a.version,
        stageId: app.state().stages.find((s) => s.projectId === p2.id).id,
      }),
    /project/i,
  );
});
test("exclusive claim is durable across database clients and foreign sessions cannot report", (t) => {
  const { app, store, project } = fixture(t);
  let a = ticket(app, project);
  a = app.updateTicket(a.id, {
    version: a.version,
    stageId: app
      .state()
      .stages.find((s) => s.projectId === project.id && s.role === "active").id,
  });
  const run = app.claim(a.id, { agentId: "codex", sessionId: "one" });
  const other = new Store(store.path);
  t.after(() => other.close());
  assert.throws(
    () =>
      new Service(other).claim(a.id, { agentId: "codex", sessionId: "two" }),
    (e) => e.status === 409,
  );
  assert.throws(
    () =>
      app.event(run.id, {
        eventId: "a",
        seq: 1,
        type: "progress",
        summary: "wrong",
        agentId: "codex",
        sessionId: "two",
      }),
    (e) => e.status === 403,
  );
  assert.throws(
    () =>
      app.updateTicket(a.id, {
        version: app.getTicket(a.id).version,
        ownerId: "claude",
      }),
    /handoff/i,
  );
});
test("duplicate events are idempotent and stale progress cannot resurrect completed execution", (t) => {
  const { app, project } = fixture(t);
  const a = ticket(app, project);
  const run = app.claim(a.id, { agentId: "codex", sessionId: "one" });
  const event = {
    eventId: "a",
    seq: 1,
    type: "progress",
    summary: "checking",
    progress: 45,
    agentId: "codex",
    sessionId: "one",
  };
  app.event(run.id, event);
  app.event(run.id, event);
  assert.equal(app.getTicket(a.id).execution.progress, 45);
  app.event(run.id, {
    ...event,
    eventId: "b",
    seq: 2,
    type: "complete",
    summary: "Ready for review",
  });
  assert.throws(
    () => app.event(run.id, { ...event, eventId: "c", seq: 3 }),
    /finished|released/i,
  );
  assert.notEqual(
    app.state().stages.find((s) => s.id === app.getTicket(a.id).stageId).role,
    "done",
  );
});
test("blocked and unfinished dependencies prevent claims and stale heartbeat never steals", (t) => {
  const { app, project } = fixture(t);
  const a = ticket(app, project);
  const b = ticket(app, project, { dependsOn: [a.id] });
  assert.throws(
    () => app.claim(b.id, { agentId: "codex", sessionId: "one" }),
    /depend/i,
  );
  let c = ticket(app, project, { blockedReason: "Needs specification" });
  assert.throws(
    () => app.claim(c.id, { agentId: "codex", sessionId: "one" }),
    /blocked/i,
  );
  const run = app.claim(a.id, { agentId: "codex", sessionId: "one" });
  app.store.db
    .prepare("UPDATE executions SET heartbeat_at=? WHERE id=?")
    .run("2000-01-01T00:00:00Z", run.id);
  assert.equal(app.getTicket(a.id).execution.stale, true);
  assert.throws(
    () => app.claim(a.id, { agentId: "codex", sessionId: "new" }),
    (e) => e.status === 409,
  );
});
test("completed parents require all children done and new stage positions persist", (t) => {
  const { app, project } = fixture(t);
  const parent = ticket(app, project);
  ticket(app, project, { parentId: parent.id });
  const done = app
    .state()
    .stages.find((s) => s.projectId === project.id && s.role === "done");
  assert.throws(
    () =>
      app.updateTicket(parent.id, {
        version: parent.version,
        stageId: done.id,
      }),
    /child/i,
  );
  const stage = app.createStage({
    projectId: project.id,
    name: "Release",
    position: 2,
  });
  assert.equal(
    app.updateStage(stage.id, { name: "Release check", position: 1 }).name,
    "Release check",
  );
  assert.throws(
    () => app.deleteStage(app.getTicket(parent.id).stageId),
    /ticket/i,
  );
});
test("checkpoint releases execution with evidence before owner handoff", (t) => {
  const { app, project } = fixture(t);
  const a = ticket(app, project);
  const run = app.claim(a.id, { agentId: "codex", sessionId: "one" });
  assert.throws(
    () => app.handoff(a.id, { ownerId: "claude", summary: "handoff" }),
    /checkpoint/i,
  );
  app.event(run.id, {
    agentId: "codex",
    sessionId: "one",
    eventId: "checkpoint",
    seq: 1,
    type: "checkpoint",
    summary: "Saved branch abc",
  });
  assert.equal(
    app.handoff(a.id, { ownerId: "claude", summary: "Next stage" }).ownerId,
    "claude",
  );
});

test("imported aggregate claim stays reserved until every source session is reconciled", (t) => {
  const { app, project } = fixture(t);
  const a = ticket(app, project);
  const run = app.claim(a.id, {
    agentId: "codex",
    sessionId: "primary",
    external: true,
  });
  app.store.saveExecution({
    ...run,
    heldSessions: [{ sessionId: "held", state: "suspended", releasedAt: null }],
  });
  assert.throws(
    () =>
      app.event(run.id, {
        agentId: "codex",
        sessionId: "primary",
        eventId: "done",
        seq: 1,
        type: "complete",
        summary: "Done",
      }),
    /held|reconcil/i,
  );
  assert.throws(
    () =>
      app.reconcileExternal(run.id, {
        sessionId: "primary",
        summary: "saved",
        stopped: false,
      }),
    /confirm/i,
  );
  app.reconcileExternal(run.id, {
    sessionId: "primary",
    summary: "Primary client stopped after checkpoint abc",
    stopped: true,
  });
  assert.ok(app.store.active(a.id));
  app.reconcileExternal(run.id, {
    sessionId: "held",
    summary: "Held client stopped after checkpoint def",
    stopped: true,
  });
  assert.equal(app.store.active(a.id), null);
});

test("stage role edits cannot silently turn occupied work into delivered work", (t) => {
  const { app, project } = fixture(t);
  const x = ticket(app, project);
  app.claim(x.id, { agentId: "codex", sessionId: "active" });
  assert.throws(
    () => app.updateStage(x.stageId, { role: "done" }),
    (e) => e.code === "STAGE_IN_USE",
  );
  assert.equal(app.require("stage", x.stageId).role, "planning");
});
test("linked GitHub repository identity cannot be retargeted to another repository", (t) => {
  const { app, store, project } = fixture(t);
  app.updateProject(project.id, { repo: "owner/original" });
  const x = ticket(app, project);
  store.put("ticket", {
    ...x,
    github: { number: 7, url: "https://github.com/owner/original/issues/7" },
  });
  assert.throws(
    () => app.updateProject(project.id, { repo: "owner/another" }),
    (e) => e.code === "LINKED_REPOSITORY",
  );
  assert.equal(app.require("project", project.id).repo, "owner/original");
});

test("unresolved publication prevents repository retarget before its response arrives", (t) => {
  const { app, store, project } = fixture(t);
  app.updateProject(project.id, { repo: "owner/original" });
  const x = ticket(app, project);
  store.put("publish-intent", {
    id: x.id,
    projectId: project.id,
    state: "pending",
  });
  assert.throws(
    () => app.updateProject(project.id, { repo: "owner/another" }),
    (e) => e.code === "LINKED_REPOSITORY",
  );
});

test("in-flight first import holds repository identity before any ticket exists", (t) => {
  const { app, store, project } = fixture(t);
  app.updateProject(project.id, { repo: "owner/original" });
  store.put("project-sync-intent", {
    id: project.id,
    projectId: project.id,
    state: "pending",
  });
  assert.throws(
    () => app.updateProject(project.id, { repo: "owner/another" }),
    (e) => e.code === "LINKED_REPOSITORY",
  );
});
