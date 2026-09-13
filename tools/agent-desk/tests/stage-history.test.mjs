import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.mjs";
import { Service } from "../server/service.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
function fixture(t) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  store.put("stage", { id: "backlog", name: "Backlog", role: "backlog" });
  store.put("stage", { id: "ready", name: "Ready", role: "ready" });
  return store;
}
test("creation and each actual stage change append server timestamps and captured names", (t) => {
  const store = fixture(t);
  const start = Date.now();
  const first = store.put("ticket", {
    id: "a",
    stageId: "backlog",
    stageChangedAt: "forged",
    stageHistory: [{ at: "forged" }],
  });
  assert.equal(first.stageHistory.length, 1);
  assert.equal(first.stageHistory[0].fromStageId, null);
  assert.equal(first.stageHistory[0].fromStageName, null);
  assert.equal(first.stageHistory[0].toStageName, "Backlog");
  assert.equal(first.stageChangedAt, first.stageHistory[0].at);
  assert.ok(Date.parse(first.stageChangedAt) >= start);
  const moved = store.put("ticket", { ...first, stageId: "ready" });
  assert.equal(moved.stageHistory.length, 2);
  assert.deepEqual(moved.stageHistory[1], {
    fromStageId: "backlog",
    fromStageName: "Backlog",
    toStageId: "ready",
    toStageName: "Ready",
    at: moved.stageChangedAt,
  });
});
test("nonstage edits and stale payloads cannot remove or forge recorded history", (t) => {
  const store = fixture(t);
  const first = store.put("ticket", { id: "a", stageId: "backlog" });
  const moved = store.put("ticket", { ...first, stageId: "ready" });
  const edit = store.put("ticket", {
    ...first,
    stageId: "ready",
    title: "Other content",
    stageChangedAt: "forged",
    stageHistory: [],
  });
  assert.deepEqual(edit.stageHistory, moved.stageHistory);
  assert.equal(edit.stageChangedAt, moved.stageChangedAt);
  assert.throws(
    () => store.put("ticket", { ...first, stageId: "backlog" }, first.version),
    /changed/,
  );
  assert.deepEqual(store.get("ticket", "a").stageHistory, moved.stageHistory);
});
test("legacy ticket gets no invented timestamp until its next real transition", (t) => {
  const store = fixture(t);
  store.db
    .prepare("INSERT INTO records(kind,id,version,data) VALUES(?,?,?,?)")
    .run(
      "ticket",
      "legacy",
      1,
      JSON.stringify({ id: "legacy", stageId: "backlog" }),
    );
  const unchanged = store.put("ticket", {
    id: "legacy",
    stageId: "backlog",
    title: "Edited",
  });
  assert.equal(Object.hasOwn(unchanged, "stageChangedAt"), false);
  assert.equal(Object.hasOwn(unchanged, "stageHistory"), false);
  const changed = store.put("ticket", { ...unchanged, stageId: "ready" });
  assert.equal(changed.stageHistory.length, 1);
  assert.equal(changed.stageHistory[0].fromStageName, "Backlog");
  assert.ok(Number.isFinite(Date.parse(changed.stageChangedAt)));
});
test("explicit stage-ID normalization preserves history and rollback is atomic", (t) => {
  const store = fixture(t);
  store.put("stage", { id: "old-ready", name: "Ready", role: "ready" });
  const first = store.put("ticket", { id: "a", stageId: "old-ready" });
  const normalized = store.put(
    "ticket",
    { ...first, stageId: "ready" },
    undefined,
    { stageNormalization: true },
  );
  assert.deepEqual(normalized.stageHistory, first.stageHistory);
  assert.equal(normalized.stageChangedAt, first.stageChangedAt);
  assert.throws(
    () =>
      store.transaction(() => {
        store.put("ticket", { ...normalized, stageId: "backlog" });
        throw Error("rollback");
      }),
    /rollback/,
  );
  assert.equal(store.get("ticket", "a").stageId, "ready");
  assert.deepEqual(store.get("ticket", "a").stageHistory, first.stageHistory);
});
test("ordinary stage moves with identical roles still create events", (t) => {
  const store = fixture(t);
  store.put("stage", { id: "other-ready", name: "Other Ready", role: "ready" });
  const first = store.put("ticket", { id: "same-role", stageId: "ready" });
  const moved = store.put("ticket", { ...first, stageId: "other-ready" });
  assert.equal(moved.stageHistory.length, 2);
  assert.equal(moved.stageHistory[1].toStageName, "Other Ready");
});
test("normalization preserves absent legacy metadata and ignores payload spoofing", (t) => {
  const store = fixture(t);
  store.db
    .prepare("INSERT INTO records(kind,id,version,data) VALUES(?,?,?,?)")
    .run("ticket", "old", 1, JSON.stringify({ id: "old", stageId: "backlog" }));
  const moved = store.put(
    "ticket",
    {
      id: "old",
      stageId: "ready",
      stageHistory: [{ at: "forged" }],
      stageChangedAt: "forged",
    },
    undefined,
    { stageNormalization: true },
  );
  assert.equal(Object.hasOwn(moved, "stageHistory"), false);
  assert.equal(Object.hasOwn(moved, "stageChangedAt"), false);
});
test("history survives a fresh database connection and direct imported updates use observation time", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "desk-history-"));
  const path = join(dir, "state.db");
  const first = new Store(path);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  first.put("stage", { id: "backlog", name: "Backlog", role: "backlog" });
  first.put("stage", { id: "ready", name: "Ready", role: "ready" });
  const created = first.put("ticket", {
    id: "a",
    stageId: "backlog",
    updatedAt: "2000-01-01T00:00:00Z",
  });
  first.close();
  const second = new Store(path);
  t.after(() => second.close());
  const moved = second.put("ticket", {
    id: "a",
    stageId: "ready",
    stageHistory: [],
    updatedAt: "2000-01-01T00:00:00Z",
  });
  assert.equal(moved.stageHistory.length, 2);
  assert.deepEqual(moved.stageHistory[0], created.stageHistory[0]);
  assert.notEqual(moved.stageChangedAt, moved.updatedAt);
});
test("manual transition and implementation claim both record stage entries", (t) => {
  const store = fixture(t);
  const service = new Service(store);
  const project = service.createProject({
    name: "History",
    repo: "fixture/history",
  });
  const stage = (role) =>
    store.list("stage", project.id).find((s) => s.role === role).id;
  const ticket = service.createTicket({
    projectId: project.id,
    title: "Synthetic implementation",
    ownerId: "codex",
    brief: {
      specification: "spec.md",
      acceptanceCriteria: "Timestamp visible",
      scope: "Only test fixture",
      verification: "Run regression",
      allowedPaths: "synthetic/**",
      conflictKeys: "none",
    },
  });
  const ready = service.updateTicket(
    ticket.id,
    { version: ticket.version, stageId: stage("ready") },
    { confirmedTransition: true },
  );
  service.claim(ticket.id, { agentId: "codex", sessionId: "history-fixture" });
  const active = store.get("ticket", ticket.id);
  assert.deepEqual(
    active.stageHistory.map((h) => h.toStageName),
    ["Backlog", "Ready", "In progress"],
  );
  assert.equal(active.stageHistory[1].at, ready.stageChangedAt);
});
