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
test("persisted confirmed queue survives service restart and invalidates changed content", (t) => {
  const { service, store, stage, make } = setup(t);
  const p = make({ stageId: stage("planning") });
  const run = service.claim(p.id, { agentId: "codex", sessionId: "held" });
  const children = new Map(Array.from({ length: 4 }, (_, i) => [i, {}]));
  service.runner = { children };
  const a = make({ brief });
  assert.equal(
    service.transition(a.id, {
      version: a.version,
      stageId: stage("ready"),
      ownerId: "codex",
      confirmed: true,
    }).outcome,
    "queued",
  );
  const other = new Store(store.path);
  t.after(() => other.close());
  const restarted = new Service(other);
  let launches = 0;
  restarted.runner = {
    children,
    start(key) {
      launches++;
      return restarted.claim(key, { agentId: "codex", sessionId: "restart" });
    },
  };
  restarted.dispatchConfirmed();
  assert.equal(launches, 0);
  const current = restarted.require("ticket", a.id);
  restarted.updateTicket(a.id, {
    version: current.version,
    title: "Changed approved instructions",
    brief: { ...brief, allowedPaths: "changed/scope/**" },
  });
  other.saveExecution({ ...run, releasedAt: new Date().toISOString() });
  children.clear();
  restarted.dispatchConfirmed();
  assert.equal(launches, 0);
  assert.match(other.get("launch-intent", a.id).reason, /content changed/);
});
test("unchanged confirmed queue dispatches once after restart and managed slot release", (t) => {
  const { service, store, stage, make } = setup(t);
  const occupied = make({ stageId: stage("planning") });
  const run = service.claim(occupied.id, {
    agentId: "codex",
    sessionId: "restart-held",
  });
  const children = new Map(Array.from({ length: 4 }, (_, i) => [i, {}]));
  service.runner = { children };
  const ticket = make({ brief });
  service.transition(ticket.id, {
    version: ticket.version,
    stageId: stage("ready"),
    ownerId: "codex",
    confirmed: true,
  });
  const second = new Store(store.path);
  t.after(() => second.close());
  const restarted = new Service(second);
  let launches = 0;
  restarted.runner = {
    children,
    start(key) {
      launches++;
      return restarted.claim(key, { agentId: "codex", sessionId: "restarted" });
    },
  };
  restarted.dispatchConfirmed();
  assert.equal(launches, 0);
  second.saveExecution({ ...run, releasedAt: new Date().toISOString() });
  children.clear();
  restarted.dispatchConfirmed();
  restarted.dispatchConfirmed();
  assert.equal(launches, 1);
  assert.equal(second.get("launch-intent", ticket.id).status, "started");
  assert.equal(second.get("ticket", ticket.id).stageId, stage("active"));
});
test("concurrent HTTP conflicting confirmations admit at most one", async (t) => {
  const { service, stage, make } = setup(t);
  let launches = 0;
  const server = createAppServer({
    service,
    runner: {
      availability: () => [],
      start(key) {
        launches++;
        return service.claim(key, {
          agentId: service.require("ticket", key).ownerId,
          sessionId: "race-" + key,
        });
      },
    },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const a = make({ brief }),
    b = make({ brief });
  const results = await Promise.all(
    [a, b].map((ticket, index) =>
      fetch(
        `http://127.0.0.1:${server.address().port}/api/tickets/${ticket.id}/transition`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            version: ticket.version,
            stageId: stage("ready"),
            ownerId: index ? "claude" : "codex",
            confirmed: true,
          }),
        },
      ),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(launches, 1);
  assert.equal([a, b].filter((t) => service.store.active(t.id)).length, 1);
});
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "ready-"));
  const store = new Store(join(dir, "db"));
  const service = new Service(store);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const project = service.createProject({
    name: "Fixture",
    repo: "org/repo",
    path: dir,
  });
  const stage = (role) =>
    store.list("stage", project.id).find((s) => s.role === role).id;
  const make = (extra = {}) =>
    service.createTicket({
      projectId: project.id,
      title: "Synthetic work",
      ownerId: "codex",
      ...extra,
    });
  return { store, service, project, stage, make };
}
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
test("confirmed capacity queue persists and rechecks preparation before dispatch", (t) => {
  const { service, store, stage, make } = setup(t);
  const occupied = make({ stageId: stage("planning") });
  const run = service.claim(occupied.id, {
    agentId: "codex",
    sessionId: "occupied",
  });
  let launches = 0;
  const children = new Map(Array.from({ length: 4 }, (_, i) => [i, {}]));
  service.runner = {
    children,
    start(key) {
      launches++;
      return service.claim(key, { agentId: "codex", sessionId: "new" });
    },
  };
  const ticket = make({ brief });
  const admitted = service.transition(ticket.id, {
    version: ticket.version,
    stageId: stage("ready"),
    ownerId: "codex",
    confirmed: true,
  });
  assert.equal(admitted.outcome, "queued");
  assert.equal(launches, 0);
  assert.equal(service.getTicket(ticket.id).launchIntent.status, "queued");
  const current = service.require("ticket", ticket.id);
  service.updateTicket(ticket.id, {
    version: current.version,
    blockedReason: "new dependency evidence",
  });
  store.saveExecution({
    ...run,
    releasedAt: new Date().toISOString(),
    state: "checkpointed",
  });
  children.clear();
  service.dispatchConfirmed();
  assert.equal(launches, 0);
  assert.equal(store.get("launch-intent", ticket.id).status, "failed");
  assert.match(store.get("launch-intent", ticket.id).reason, /Blocked/i);
});
test("queue launches exactly once after managed slot release and stale confirmation has no effects", (t) => {
  const { service, store, stage, make } = setup(t);
  const occupied = make({ stageId: stage("planning") });
  const run = service.claim(occupied.id, {
    agentId: "codex",
    sessionId: "occupied",
  });
  let launches = 0;
  const children = new Map(Array.from({ length: 4 }, (_, i) => [i, {}]));
  service.runner = {
    children,
    start(key) {
      launches++;
      return service.claim(key, { agentId: "codex", sessionId: "queued" });
    },
  };
  const ticket = make({ brief });
  const input = {
    version: ticket.version,
    stageId: stage("ready"),
    ownerId: "codex",
    confirmed: true,
  };
  assert.equal(service.transition(ticket.id, input).outcome, "queued");
  assert.throws(() => service.transition(ticket.id, input), /changed/i);
  store.saveExecution({ ...run, releasedAt: new Date().toISOString() });
  children.clear();
  service.dispatchConfirmed();
  service.dispatchConfirmed();
  assert.equal(launches, 1);
  assert.equal(store.get("launch-intent", ticket.id).status, "started");
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
test("HTTP readiness and transition require admin and preserve stale-stage atomicity", async (t) => {
  const { service, stage, make } = setup(t);
  const runner = {
    availability: () => [],
    start(key) {
      return service.claim(key, { agentId: "codex", sessionId: "http" });
    },
  };
  const server = createAppServer({
    service,
    runner,
    adminToken: "admin-fixture",
    agentTokens: { codex: "agent-fixture" },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${server.address().port}/api/tickets/`;
  const ticket = make({ brief });
  const request = (suffix, method = "GET", input, token = "admin-fixture") =>
    fetch(url + ticket.id + suffix, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      ...(input ? { body: JSON.stringify(input) } : {}),
    });
  assert.equal(
    (await request("/readiness", "GET", undefined, "agent-fixture")).status,
    403,
  );
  assert.equal((await (await request("/readiness")).json()).ready, true);
  const input = {
    version: ticket.version,
    stageId: stage("ready"),
    ownerId: "codex",
    confirmed: true,
  };
  assert.equal(
    (await request("/transition", "POST", input, "agent-fixture")).status,
    403,
  );
  const result = await request("/transition", "POST", input);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).outcome, "started");
  assert.equal((await request("/transition", "POST", input)).status, 409);
});
test("external agent confirms into Planning cleanly without launch supervisor or runner.start", (t) => {
  const { service, store, stage, make } = setup(t);
  const ticket = make({ stageId: stage("backlog"), ownerId: "gemini" });
  let runnerInvoked = false;
  service.runner = {
    children: new Map(),
    availability: () => [{ id: "gemini", available: false, reason: "Reports through CLI/MCP; no direct launch adapter" }],
    start: () => {
      runnerInvoked = true;
      throw new Error("Runner start should not be called for external agent");
    },
  };
  const result = service.transition(ticket.id, {
    version: ticket.version,
    stageId: stage("planning"),
    ownerId: "gemini",
    confirmed: true,
  });
  assert.equal(result.outcome, "started");
  assert.equal(runnerInvoked, false);
  const updated = service.getTicket(ticket.id);
  assert.equal(updated.stageId, stage("planning"));
  assert.equal(updated.ownerId, "gemini");
  const intent = store.get("launch-intent", ticket.id);
  assert.equal(intent.status, "started");
  assert.match(intent.reason, /external/i);
});

