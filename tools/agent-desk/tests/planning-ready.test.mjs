import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";
import { Service } from "../server/service.mjs";
import { createAppServer } from "../server/http.mjs";
import { buildTaskPacket } from "../server/task-packet.mjs";
const brief = {
  specification: "spec.md",
  acceptanceCriteria: "Observable result",
  scope: "Implement feature",
  verification: "Run contract test",
  allowedPaths: "src/a/**",
  conflictKeys: "none",
};
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "ready-"));
  const store = new Store(join(dir, "db"));
  const service = new Service(store);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const project = service.createProject({ name: "Fixture", repo: "org/repo", path: dir });
  const stage = (role) => store.list("stage", project.id).find((s) => s.role === role).id;
  const make = (extra = {}) => service.createTicket({
    projectId: project.id, title: "Synthetic work", ownerId: "codex", ...extra,
  });
  return { store, service, project, stage, make };
}
test("repeated separators and symlink scopes cannot bypass conflicts", (t) => {
  const { service, project, stage, make } = setup(t);
  mkdirSync(join(project.path, "real"));
  symlinkSync(join(project.path, "real"), join(project.path, "alias"));
  for (const allowedPaths of ["src//a/**", "alias/**", "alias/new/file"])
    assert.throws(
      () =>
        make({ stageId: stage("ready"), brief: { ...brief, allowedPaths } }),
      /ready/i,
    );
});
test("planning child creation records same-project sibling dependencies", (t) => {
  const { service, stage, make } = setup(t);
  const parent = make({ stageId: stage("planning") });
  const run = service.claim(parent.id, {
    agentId: "codex",
    sessionId: "decompose",
  });
  const scope = {
    agentId: "codex",
    sessionId: run.sessionId,
    executionId: run.id,
    reason: "Independent slices",
  };
  const a = service.createSubtask(parent.id, { ...scope, title: "First" });
  const b = service.createSubtask(parent.id, {
    ...scope,
    title: "Second",
    dependsOn: [a.id],
  });
  assert.equal(b.stageId, stage("planning"));
  assert.deepEqual(b.dependsOn, [a.id]);
  assert.match(service.readiness(b.id).holds.join(" "), /dependency/);
});
test("six stages and incomplete Ready creation rejected", (t) => {
  const { service, store, project, stage, make } = setup(t);
  assert.deepEqual(
    store
      .list("stage", project.id)
      .sort((a, b) => a.position - b.position)
      .map((s) => s.role),
    ["backlog", "planning", "ready", "active", "review", "done"],
  );
  assert.throws(() => make({ stageId: stage("ready") }), /prepar|ready/i);
});
test("confirmed admission and overlapping repository scope fail without mutation", (t) => {
  const { service, stage, make } = setup(t);
  const a = make({ brief });
  const b = make({ brief });
  assert.throws(
    () =>
      service.updateTicket(a.id, {
        version: a.version,
        stageId: stage("ready"),
      }),
    /confirm/i,
  );
  service.transition(a.id, {
    version: a.version,
    stageId: stage("ready"),
    ownerId: "codex",
    confirmed: true,
  });
  assert.equal(service.readiness(b.id).conflicts[0].ticketId, a.id);
  assert.throws(
    () =>
      service.transition(b.id, {
        version: b.version,
        stageId: stage("ready"),
        ownerId: "claude",
        confirmed: true,
      }),
    /ready|conflict/i,
  );
  assert.equal(service.require("ticket", b.id).stageId, b.stageId);
});
test("planning claims stay planning and retry survives edited brief; scope snapshot blocks shrink", (t) => {
  const { service, store, stage, make } = setup(t);
  const p = make({ stageId: stage("planning") });
  const planning = service.claim(p.id, { agentId: "codex", sessionId: "plan" });
  assert.equal(planning.purpose, "planning");
  const a = make({ stageId: stage("ready"), brief });
  const run = service.claim(a.id, { agentId: "codex", sessionId: "build" });
  const current = service.require("ticket", a.id);
  store.put("ticket", {
    ...current,
    brief: { ...brief, allowedPaths: "other/**" },
    stageId: stage("backlog"),
  });
  assert.equal(
    service.claim(a.id, { agentId: "codex", sessionId: "build" }).id,
    run.id,
  );
  const b = make({ brief });
  assert.equal(service.readiness(b.id).conflicts[0].ticketId, a.id);
});
test("shared keys and repository aliases conflict; unknown legacy reservation retained", (t) => {
  const { service, store, project, stage, make } = setup(t);
  const a = make({
    stageId: stage("ready"),
    brief: { ...brief, conflictKeys: "api.contract" },
  });
  const alias = service.createProject({ name: "Alias", repo: "ORG/REPO" });
  const b = service.createTicket({
    projectId: alias.id,
    title: "Other file",
    brief: {
      ...brief,
      allowedPaths: "elsewhere/file",
      conflictKeys: "API.Contract",
    },
  });
  assert.equal(service.readiness(b.id).conflicts[0].ticketId, a.id);
  const old = make();
  store.put("ticket", {
    ...service.require("ticket", old.id),
    stageId: stage("active"),
  });
  const c = make({ brief: { ...brief, allowedPaths: "nonoverlap/**" } });
  assert.ok(
    service
      .readiness(c.id)
      .conflicts.some(
        (x) =>
          x.ticketId === old.id && x.reasons.includes("Unknown reserved scope"),
      ),
  );
});
test("invalid paths, parent containers, and dependencies cannot become Ready", (t) => {
  const { service, stage, make } = setup(t);
  for (const allowedPaths of [
    "../escape",
    "/absolute",
    "src/*/x",
    "src/./x",
    "src/../../x",
  ])
    assert.throws(
      () =>
        make({ stageId: stage("ready"), brief: { ...brief, allowedPaths } }),
      /ready/i,
    );
  const parent = make({ brief });
  make({ parentId: parent.id });
  assert.match(service.readiness(parent.id).holds.join(" "), /Parent/);
  const dep = make();
  assert.throws(
    () => make({ stageId: stage("ready"), brief, dependsOn: [dep.id] }),
    /dependency/i,
  );
});
test("planning packet and completion remain preparation only", (t) => {
  const { service, project, stage, make } = setup(t);
  const ticket = make({ stageId: stage("planning") });
  const execution = service.claim(ticket.id, {
    agentId: "codex",
    sessionId: "planning",
  });
  const packet = buildTaskPacket({
    ticket,
    project,
    execution,
    worktree: "/synthetic",
  });
  assert.match(packet, /Planning only/);
  assert.match(packet, /acceptance tests/);
  assert.match(packet, /does not authorize production implementation/);
  const end = service.event(execution.id, {
    agentId: "codex",
    sessionId: "planning",
    eventId: "done",
    seq: 1,
    type: "complete",
    summary: "Specification prepared",
  });
  assert.equal(end.state, "checkpointed");
  assert.equal(service.require("ticket", ticket.id).stageId, stage("planning"));
});
test("parent container stages synchronize as child subtasks advance to review and done", (t) => {
  const { service, stage, make } = setup(t);
  const parent = make({ stageId: stage("planning") });
  const child = make({ parentId: parent.id, stageId: stage("active") });

  service.syncParentContainerStage(parent.id);
  assert.equal(service.getTicket(parent.id).stageId, stage("active"));

  // When child moves to review, parent moves to review
  service.updateTicket(child.id, { version: child.version, stageId: stage("review") });
  assert.equal(service.getTicket(parent.id).stageId, stage("review"));

  // When child moves to done, parent moves to done
  const currentChild = service.getTicket(child.id);
  service.updateTicket(child.id, { version: currentChild.version, stageId: stage("done") });
  assert.equal(service.getTicket(parent.id).stageId, stage("done"));
});

test("held parent stays active when its only existing child finishes", (t) => {
  const { service, stage, make } = setup(t);
  const parent = make({ stageId: stage("planning"), blockedReason: "C1-C3 still require review" });
  const child = make({ parentId: parent.id, stageId: stage("active") });

  service.syncParentContainerStage(parent.id);
  assert.equal(service.getTicket(parent.id).stageId, stage("active"));
  service.updateTicket(child.id, { version: child.version, stageId: stage("review") });
  assert.equal(service.getTicket(parent.id).stageId, stage("active"));
  const reviewedChild = service.getTicket(child.id);
  service.updateTicket(child.id, { version: reviewedChild.version, stageId: stage("done") });
  const held = service.getTicket(parent.id);
  assert.equal(held.stageId, stage("active"));
  assert.equal(held.blockedReason, "C1-C3 still require review");
  assert.throws(
    () => service.updateTicket(parent.id, { version: held.version, stageId: stage("done") }),
    /hold|block/i,
  );

  const released = service.updateTicket(parent.id, { version: held.version, blockedReason: "" });
  assert.equal(service.getTicket(parent.id).stageId, stage("done"));
  assert.equal(released.stageId, stage("done"));
  assert.equal(released.version, service.getTicket(parent.id).version);
});

test("confirmed parent Planning assignment survives rollup until its exact claim", (t) => {
  const { service, stage, make } = setup(t);
  const parent = make({ stageId: stage("active"), blockedReason: "C1 contract review" });
  const child = make({ parentId: parent.id, stageId: stage("active") });
  service.updateTicket(child.id, { version: child.version, stageId: stage("done") });
  const held = service.getTicket(parent.id);
  assert.equal(held.stageId, stage("active"));

  const admitted = service.transition(parent.id, {
    version: held.version,
    stageId: stage("planning"),
    ownerId: "codex",
    confirmed: true,
  });
  assert.equal(admitted.outcome, "moved");
  assert.equal(admitted.ticket.launchIntent, null);
  service.syncAllParentContainers();
  assert.equal(service.getTicket(parent.id).stageId, stage("planning"));
  const claim = service.claim(parent.id, {
    agentId: "codex",
    sessionId: "same-native-planning-session",
    external: true,
  });
  assert.equal(claim.purpose, "planning");
  assert.equal(service.getTicket(parent.id).stageId, stage("planning"));
  service.event(claim.id, {
    agentId: "codex",
    sessionId: claim.sessionId,
    eventId: "planning-checkpoint",
    seq: 1,
    type: "checkpoint",
    summary: "Contract review saved",
  });
  assert.equal(service.getTicket(parent.id).stageId, stage("active"));
});

test("external agent Planning assignment holds parent until checkpoint", (t) => {
  const { service, store, stage, make } = setup(t);
  const parent = make({ stageId: stage("active"), ownerId: "hermes", blockedReason: "Contract review" });
  const child = make({ parentId: parent.id, stageId: stage("active") });
  service.updateTicket(child.id, { version: child.version, stageId: stage("done") });
  const current = service.getTicket(parent.id);
  const admitted = service.transition(parent.id, {
    version: current.version,
    stageId: stage("planning"),
    ownerId: "hermes",
    confirmed: true,
  });
  assert.equal(admitted.outcome, "moved");
  assert.equal(admitted.ticket.launchIntent, null);
  service.syncAllParentContainers();
  assert.equal(service.getTicket(parent.id).stageId, stage("planning"));
  const claim = service.claim(parent.id, {
    agentId: "hermes",
    sessionId: "hermes-planning",
    external: true,
  });
  assert.equal(store.get("launch-intent", parent.id), null);
  service.event(claim.id, {
    agentId: "hermes",
    sessionId: claim.sessionId,
    eventId: "hermes-planning-checkpoint",
    seq: 1,
    type: "checkpoint",
    summary: "Contract review saved",
  });
  assert.equal(service.getTicket(parent.id).stageId, stage("active"));
});

test("reconciled external planning claim immediately releases parent rollup", (t) => {
  const { service, stage, make } = setup(t);
  const parent = make({ stageId: stage("active"), blockedReason: "Contract review" });
  const child = make({ parentId: parent.id, stageId: stage("active") });
  service.updateTicket(child.id, { version: child.version, stageId: stage("done") });
  const current = service.getTicket(parent.id);
  service.transition(parent.id, {
    version: current.version,
    stageId: stage("planning"),
    ownerId: "codex",
    confirmed: true,
  });
  const claim = service.claim(parent.id, {
    agentId: "codex",
    sessionId: "reconciled-planning-session",
    external: true,
  });
  const released = service.reconcileExternal(claim.id, {
    sessionId: claim.sessionId,
    stopped: true,
    summary: "The native planning session saved its state",
  });
  assert.ok(released.releasedAt);
  assert.equal(service.getTicket(parent.id).stageId, stage("active"));
});

test("parent with an unfinished hard dependency cannot be marked done by child rollup", (t) => {
  const { service, stage, make } = setup(t);
  const dependency = make({ stageId: stage("planning") });
  const parent = make({ stageId: stage("planning"), dependsOn: [dependency.id] });
  const child = make({ parentId: parent.id, stageId: stage("active") });
  service.updateTicket(child.id, { version: child.version, stageId: stage("done") });
  const held = service.getTicket(parent.id);
  assert.equal(held.stageId, stage("active"));
  assert.throws(
    () => service.updateTicket(parent.id, { version: held.version, stageId: stage("done") }),
    /hold|depend/i,
  );
  service.updateTicket(dependency.id, { version: dependency.version, stageId: stage("done") });
  assert.equal(service.getTicket(parent.id).stageId, stage("done"));
});

test("cross-project dependencies release a completed parent through public updates", (t) => {
  const { service, store, stage, make } = setup(t);
  const other = service.createProject({ name: "External", repo: "org/other" });
  const otherStage = (role) => store.list("stage", other.id).find((s) => s.role === role).id;
  const dependency = service.createTicket({
    projectId: other.id,
    title: "External prerequisite",
    stageId: otherStage("active"),
  });
  const parent = make({ stageId: stage("planning"), dependsOn: [dependency.id] });
  const child = make({ parentId: parent.id, stageId: stage("active") });
  service.updateTicket(child.id, { version: child.version, stageId: stage("done") });
  assert.equal(service.getTicket(parent.id).stageId, stage("active"));
  service.updateTicket(dependency.id, { version: dependency.version, stageId: otherStage("done") });
  assert.equal(service.getTicket(parent.id).stageId, stage("done"));

  const secondParent = make({ stageId: stage("planning"), dependsOn: [dependency.id] });
  const secondChild = make({ parentId: secondParent.id, stageId: stage("active") });
  service.updateTicket(secondChild.id, { version: secondChild.version, stageId: stage("done") });
  assert.equal(service.getTicket(secondParent.id).stageId, stage("done"));
});

test("planning with remaining blocker or unfinished dependency remains in Planning without advancing", (t) => {
  const { service, stage, make } = setup(t);
  const dep = make();
  const ticket = make({ stageId: stage("planning"), brief, dependsOn: [dep.id] });
  let runnerInvoked = false;
  service.runner = {
    children: new Map(),
    availability: () => [{ id: "codex", available: true }],
    start: () => {
      runnerInvoked = true;
    },
  };
  const run = service.claim(ticket.id, { agentId: "codex", sessionId: "plan-blocked" });

  service.event(run.id, {
    agentId: "codex",
    sessionId: run.sessionId,
    eventId: "blocked-complete",
    seq: 1,
    type: "complete",
    summary: "Plan prepared but dependency remains unfinished",
  });

  assert.equal(runnerInvoked, false);
  assert.equal(service.require("ticket", ticket.id).stageId, stage("planning"));
});
