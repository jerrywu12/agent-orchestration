import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";
import { Service } from "../server/service.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "desk-effort-"));
  let store = new Store(join(dir, "desk.db"));
  let app = new Service(store);
  const project = app.createProject({ name: "Effort" });
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return {
    get store() { return store; }, get app() { return app; }, project,
    create: (extra = {}) => app.createTicket({ projectId: project.id, title: "Estimate", ...extra }),
    restart() { const path = store.path; store.close(); store = new Store(path); app = new Service(store); },
  };
}

test("effort accepts each estimate, edits and clears durably without changing labels or workflow metadata", t => {
  const f = fixture(t);
  for (const effort of [null, "XS", "S", "M", "L", "XL"]) {
    const ticket = f.create({ effort, labels: ["effort:S", "keep"] });
    assert.equal(ticket.effort, effort);
    f.restart();
    assert.equal(f.app.getTicket(ticket.id).effort, effort);
    const before = f.store.get("ticket", ticket.id);
    const next = f.app.updateTicket(ticket.id, { version: before.version, effort: "XL" });
    for (const key of ["labels", "brief", "ownerId", "stageId", "stageHistory", "dependsOn", "parentId", "createdAt", "github"]) assert.deepEqual(next[key], before[key], key);
    assert.throws(() => f.app.updateTicket(ticket.id, { version: before.version, effort: "M" }), { code: "VERSION_CONFLICT" });
    const cleared = f.app.updateTicket(ticket.id, { version: next.version, effort: null });
    assert.equal(cleared.effort, null);
    f.restart();
    assert.equal(f.app.getTicket(ticket.id).effort, null);
  }
});

test("legacy missing effort reads unset without rewriting raw data or interpreting labels", t => {
  const f = fixture(t), ticket = f.create({ labels: ["effort:M"] });
  const raw = f.store.get("ticket", ticket.id); delete raw.effort;
  f.store.db.prepare("UPDATE records SET data=? WHERE kind='ticket' AND id=?").run(JSON.stringify(raw), ticket.id);
  assert.equal(f.app.getTicket(ticket.id).effort, null);
  assert.equal(f.app.state().tickets[0].effort, null);
  assert.equal(Object.hasOwn(f.store.get("ticket", ticket.id), "effort"), false);
  const edited = f.app.updateTicket(ticket.id, { version: raw.version, title: "Legacy edit" });
  assert.equal(edited.effort, null);
  assert.deepEqual(edited.labels, ["effort:M"]);
});

test("invalid effort is rejected atomically on create and update", t => {
  const f = fixture(t), ticket = f.create();
  for (const effort of ["", "xs", "XXL", "2", 2, false, [], {}]) {
    assert.throws(() => f.create({ effort }), { code: "VALIDATION" });
    assert.throws(() => f.app.updateTicket(ticket.id, { version: ticket.version, effort }), { code: "VALIDATION" });
    assert.equal(f.app.getTicket(ticket.id).version, ticket.version);
  }
});

test("effort agent updates and subtasks retain exact ownership, session and stage guards", t => {
  const f = fixture(t);
  const planning = f.app.state().stages.find(s => s.projectId === f.project.id && s.role === "planning");
  const ticket = f.create({ stageId: planning.id, ownerId: "codex" });
  const execution = f.app.claim(ticket.id, { agentId: "codex", sessionId: "effort-session" });
  const before = f.app.getTicket(ticket.id);
  const input = { agentId: "codex", executionId: execution.id, sessionId: execution.sessionId, version: before.version, reason: "Bounded estimate", changes: { effort: "S" } };
  assert.throws(() => f.app.agentUpdate(ticket.id, { ...input, sessionId: "foreign" }));
  assert.throws(() => f.app.agentUpdate(ticket.id, { ...input, agentId: "claude" }));
  const updated = f.app.agentUpdate(ticket.id, input);
  assert.equal(updated.effort, "S");
  assert.deepEqual(updated.execution, before.execution);
  assert.deepEqual(updated.stageHistory, before.stageHistory);
  assert.throws(() => f.app.agentUpdate(ticket.id, input), { code: "VERSION_CONFLICT" });
  assert.throws(() => f.app.agentUpdate(ticket.id, { ...input, version: updated.version, changes: { effort: "M", ownerId: "claude" } }), { code: "AGENT_FIELDS" });
  const child = f.app.createSubtask(ticket.id, { agentId: input.agentId, executionId: input.executionId, sessionId: input.sessionId, reason: "Separate bounded work", title: "Child estimate", effort: "XS" });
  assert.equal(child.effort, "XS");
  assert.equal(child.ownerId, "codex");
  assert.equal(child.parentId, ticket.id);
  assert.equal(child.stageId, planning.id);
});

test("changing only effort preserves a confirmed launch fingerprint", t => {
  const f = fixture(t), ticket = f.create({ effort: "S" });
  const before = f.app.launchFingerprint(ticket);
  const updated = f.app.updateTicket(ticket.id, { version: ticket.version, effort: "XL" });
  assert.equal(f.app.launchFingerprint(updated), before);
});
