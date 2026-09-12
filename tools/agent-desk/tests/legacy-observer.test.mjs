import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";
import { Service } from "../server/service.mjs";
import { importKangentic } from "../server/migrate.mjs";
import { LegacyObserver } from "../server/legacy-observer.mjs";

async function fixture(t, { multiple = false, missing = false } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "desk-legacy-")));
  const source = join(dir, "source");
  mkdirSync(join(source, "projects"), { recursive: true });
  const index = new DatabaseSync(join(source, "index.db"));
  index.exec(
    "CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT,path TEXT); INSERT INTO projects VALUES('p','Example','/missing/repository');",
  );
  index.close();
  const dbPath = join(source, "projects/p.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE swimlanes(id TEXT PRIMARY KEY,name TEXT,position INTEGER,role TEXT);
    INSERT INTO swimlanes VALUES('parked','Parked',0,'parked');
    CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT,swimlane_id TEXT,agent TEXT,session_id TEXT,labels TEXT);
    CREATE TABLE sessions(id TEXT PRIMARY KEY,task_id TEXT,agent_session_id TEXT,status TEXT,started_at TEXT,exited_at TEXT,prompt TEXT,command TEXT);
    CREATE TABLE transcripts(session_id TEXT,content TEXT);
    INSERT INTO sessions VALUES('a','task','native-a','running','2026-09-01T00:00:00Z',NULL,'PRIVATE_PROMPT','PRIVATE_COMMAND');
    INSERT INTO transcripts VALUES('a','PRIVATE_TRANSCRIPT');`);
  if (multiple)
    db.exec(
      "INSERT INTO sessions VALUES('b','task','native-b','suspended','2026-09-02T00:00:00Z',NULL,'PRIVATE_PROMPT','PRIVATE_COMMAND');",
    );
  db.prepare(
    "INSERT INTO tasks VALUES('task','Imported work','parked','codex',?,'[\"owner:codex\"]')",
  ).run(missing ? "missing-handle" : "a");
  const store = new Store(join(dir, "desk.db"));
  const service = new Service(store);
  await importKangentic(service, source, { backupDir: join(dir, "backup") });
  const ticket = service.state().tickets[0];
  const observer = new LegacyObserver(service, { auto: false });
  t.after(() => {
    observer.close();
    store.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, source, dbPath, db, store, service, ticket, observer };
}
const bytes = (f) =>
  [f.dbPath, `${f.dbPath}-wal`].map((p) => readFileSync(p).toString("hex"));

test("legacy running then exited observations retain the claim without inventing progress or delivery", async (t) => {
  const f = await fixture(t);
  const original = f.store.execution(f.ticket.execution.id);
  let before = bytes(f);
  assert.equal(f.observer.tick().observed, 1);
  let run = f.store.active(f.ticket.id);
  assert.equal(run.sourceState, "running");
  assert.ok(Date.parse(run.sourceObservedAt));
  assert.equal(run.sourceExitedAt, null);
  assert.match(run.summary, /legacy source/i);
  assert.deepEqual(bytes(f), before);
  f.db.exec(
    "UPDATE sessions SET status='exited',exited_at='2026-09-13T01:02:03Z' WHERE id='a'",
  );
  before = bytes(f);
  f.observer.tick();
  run = f.store.active(f.ticket.id);
  assert.equal(run.sourceState, "exited");
  assert.equal(run.sourceExitedAt, "2026-09-13T01:02:03.000Z");
  assert.equal(run.releasedAt, null);
  assert.equal(run.state, original.state);
  assert.equal(run.heartbeatAt, original.heartbeatAt);
  assert.equal(run.progress, null);
  assert.equal(run.lastSeq, 0);
  assert.equal(f.store.get("ticket", f.ticket.id).stageId, f.ticket.stageId);
  assert.equal(f.store.get("ticket", f.ticket.id).version, f.ticket.version);
  assert.deepEqual(bytes(f), before);
  assert.doesNotMatch(
    JSON.stringify(run),
    /PRIVATE_|prompt|command|transcript/i,
  );
});

test("every mapped held session and missing imported current handle remains visible and reserved", async (t) => {
  const f = await fixture(t, { multiple: true, missing: true });
  f.observer.tick();
  let run = f.store.active(f.ticket.id);
  assert.equal(run.sourceSessions.length, 3);
  assert.equal(run.sourceState, "missing");
  assert.deepEqual(
    new Set(run.sourceSessions.map((s) => s.sessionId)),
    new Set(["native-a", "native-b", "missing-handle"]),
  );
  assert.equal(
    run.heldSessions.find((s) => s.sessionId === "missing-handle").sourceState,
    "missing",
  );
  f.db.exec(
    "UPDATE sessions SET status='exited',exited_at='2026-09-13T01:02:03Z'",
  );
  f.observer.tick();
  run = f.store.active(f.ticket.id);
  assert.equal(run.sourceState, "missing");
  assert.equal(run.sourceExitedAt, null);
  assert.ok(run.heldSessions.every((s) => s.releasedAt === null));
  f.service.reconcileExternal(run.id, {
    sessionId: "native-a",
    summary: "Exact native session stopped",
    stopped: true,
  });
  f.observer.tick();
  assert.equal(
    f.store
      .active(f.ticket.id)
      .heldSessions.find((s) => s.sessionId === "native-a").state,
    "checkpointed",
  );
});

test("missing rows and unavailable source remain factual while unrelated source sessions are ignored", async (t) => {
  const f = await fixture(t);
  f.db.exec(
    "DELETE FROM sessions WHERE id='a'; INSERT INTO sessions VALUES('unmapped','task','new-native','running',NULL,NULL,'PRIVATE_PROMPT','PRIVATE_COMMAND');",
  );
  f.observer.tick();
  assert.equal(f.store.active(f.ticket.id).sourceState, "missing");
  assert.equal(f.store.active(f.ticket.id).sourceSessions.length, 1);
  renameSync(join(f.source, "projects"), join(f.source, "projects-hidden"));
  f.observer.tick();
  const run = f.store.active(f.ticket.id);
  assert.equal(run.sourceState, "unavailable");
  assert.match(run.summary, /unavailable.*claim retained/i);
  assert.equal(run.releasedAt, null);
});

test("new Agent Desk reports and reconciled executions are never overwritten", async (t) => {
  const f = await fixture(t);
  f.observer.tick();
  f.service.event(f.ticket.execution.id, {
    eventId: "new-report",
    seq: 1,
    type: "progress",
    progress: 42,
    summary: "New native report",
    agentId: "codex",
    sessionId: "native-a",
  });
  const reported = f.store.execution(f.ticket.execution.id);
  f.db.exec("UPDATE sessions SET status='exited'");
  assert.equal(f.observer.tick().observed, 0);
  assert.deepEqual(f.store.execution(reported.id), reported);
  f.service.reconcileExternal(reported.id, {
    sessionId: "native-a",
    summary: "Exact native session stopped",
    stopped: true,
  });
  const reconciled = f.store.execution(reported.id);
  f.observer.tick();
  assert.deepEqual(f.store.execution(reported.id), reconciled);
});

test("source path escapes and session views are unavailable rather than followed or evaluated", async (t) => {
  const f = await fixture(t);
  const record = f.store
    .list("migration-record")
    .find((r) => r.mapping?.sourceKind === "session");
  f.store.put("migration-record", {
    ...record,
    mapping: { ...record.mapping, sourceProjectId: "../escape" },
  });
  f.observer.tick();
  assert.equal(f.store.active(f.ticket.id).sourceState, "unavailable");
  f.store.put("migration-record", record);
  f.db.exec(
    "ALTER TABLE sessions RENAME TO source_sessions; CREATE VIEW sessions AS SELECT id, task_id, agent_session_id, prompt AS status, exited_at FROM source_sessions;",
  );
  f.observer.tick();
  assert.equal(f.store.active(f.ticket.id).sourceState, "unavailable");
  assert.doesNotMatch(JSON.stringify(f.store.active(f.ticket.id)), /PRIVATE_/);
  renameSync(join(f.source, "projects"), join(f.dir, "escaped-projects"));
  symlinkSync(join(f.dir, "escaped-projects"), join(f.source, "projects"));
  f.observer.tick();
  assert.equal(f.store.active(f.ticket.id).sourceState, "unavailable");
});

test("automatic polling uses the default fifteen-second interval and close stops observation", async (t) => {
  const f = await fixture(t);
  t.mock.timers.enable({ apis: ["setInterval"] });
  const observer = new LegacyObserver(f.service);
  t.after(() => observer.close());
  t.mock.timers.tick(14999);
  assert.equal(f.store.active(f.ticket.id).sourceState, undefined);
  t.mock.timers.tick(1);
  const seen = f.store.active(f.ticket.id);
  assert.equal(seen.sourceState, "running");
  observer.close();
  f.db.exec("UPDATE sessions SET status='exited'");
  t.mock.timers.tick(15000);
  assert.deepEqual(f.store.active(f.ticket.id), seen);
  assert.equal(observer.tick().observed, 0);
});
