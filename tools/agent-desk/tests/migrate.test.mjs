import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";
import { Service } from "../server/service.mjs";
import { previewKangentic, importKangentic } from "../server/migrate.mjs";
import { migrateWorkflow } from "../server/workflow.mjs";

function fixture(t, { projectId = "source-project" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "desk-migration-"));
  const source = join(dir, "source");
  mkdirSync(join(source, "projects"), { recursive: true });
  const index = new DatabaseSync(join(source, "index.db"));
  index.exec(
    "CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT,path TEXT,github_url TEXT,default_agent TEXT)",
  );
  index
    .prepare("INSERT INTO projects VALUES(?,?,?,?,?)")
    .run(
      projectId,
      "Research",
      "/untrusted/repo",
      "https://github.com/example/research",
      "codex",
    );
  index.close();
  const db = new DatabaseSync(join(source, "projects", "source-project.db"));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE swimlanes(id TEXT PRIMARY KEY,name TEXT,position INTEGER,role TEXT,color TEXT,auto_spawn INTEGER,agent_override TEXT,auto_command TEXT);
    CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT,description TEXT,swimlane_id TEXT,display_id INTEGER,labels TEXT,priority INTEGER,agent TEXT,session_id TEXT,branch_name TEXT,worktree_path TEXT,pr_url TEXT,pr_number INTEGER,head_sha TEXT,archived_at TEXT,created_at TEXT,updated_at TEXT,agent_override TEXT,run_mode TEXT,model_override TEXT,permission_mode TEXT,private_unrecognized TEXT);
    CREATE TABLE backlog_tasks(id TEXT PRIMARY KEY,title TEXT,description TEXT,labels TEXT,priority INTEGER,position INTEGER,external_id TEXT,external_source TEXT,external_url TEXT,external_metadata TEXT,created_at TEXT,updated_at TEXT,item_type TEXT);
    CREATE TABLE sessions(id TEXT PRIMARY KEY,task_id TEXT,agent_session_id TEXT,status TEXT,started_at TEXT,suspended_at TEXT,exited_at TEXT,cwd TEXT,prompt TEXT,command TEXT);
    CREATE TABLE backlog_attachments(id TEXT PRIMARY KEY,backlog_task_id TEXT,filename TEXT,file_path TEXT,media_type TEXT,size_bytes INTEGER,created_at TEXT);
    CREATE TABLE task_attachments(id TEXT PRIMARY KEY,task_id TEXT,filename TEXT,file_path TEXT,media_type TEXT,size_bytes INTEGER,created_at TEXT);
    CREATE TABLE session_transcripts(session_id TEXT,transcript TEXT);
    INSERT INTO swimlanes VALUES('todo','To Do',0,'backlog','#87909b',1,NULL,'PRIVATE_COMMAND');
    INSERT INTO swimlanes VALUES('parked','Parked',1,'parked','#87909b',1,'codex','PRIVATE_COMMAND');
    INSERT INTO swimlanes VALUES('review','PR / Code Review',2,'review','#87909b',0,NULL,NULL);
    INSERT INTO sessions VALUES('session-running','running-task','native-session','running','2026-09-10T00:00:00Z',NULL,NULL,'/source/worktree','PRIVATE_PROMPT','PRIVATE_COMMAND');
    INSERT INTO sessions VALUES('session-suspended','paused-task','native-paused','suspended','2026-09-09T00:00:00Z','2026-09-10T00:00:00Z',NULL,'/source/paused','PRIVATE_PROMPT','PRIVATE_COMMAND');
    INSERT INTO session_transcripts VALUES('session-running','PRIVATE_TRANSCRIPT');
    INSERT INTO backlog_attachments VALUES('attachment','backlog','plan.md','/source/specs/plan.md','text/markdown',42,'2026-09-09T00:00:00Z');`);
  const insert = db.prepare(
    "INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  for (const [key, title, stage, labels, agent, session] of [
    [
      "running-task",
      "Running task",
      "review",
      ["owner:codex", "blocked:dependency"],
      "codex",
      "session-running",
    ],
    [
      "paused-task",
      "Paused task",
      "parked",
      ["owner:claude"],
      "claude",
      "session-suspended",
    ],
    [
      "unknown-task",
      "Unknown owner",
      "todo",
      ["owner:unknown-provider"],
      "codex",
      null,
    ],
    [
      "ambiguous-task",
      "Ambiguous owner",
      "todo",
      ["owner:claude", "owner:codex"],
      "codex",
      null,
    ],
  ])
    insert.run(
      key,
      title,
      "Visible description",
      stage,
      7,
      JSON.stringify(labels),
      2,
      agent,
      session,
      "codex/source",
      "/source/worktree",
      "https://github.com/example/research/pull/1",
      1,
      "abc",
      null,
      "2026-09-09T00:00:00Z",
      "2026-09-10T00:00:00Z",
      null,
      "column_settings",
      "model-kept",
      "plan",
      "PRIVATE_UNRECOGNIZED",
    );
  db.prepare("INSERT INTO backlog_tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
    "backlog",
    "Planned work",
    "Backlog description",
    JSON.stringify(["owner:arkcli", "blocked:duplicate-reference"]),
    1,
    3,
    "item-id",
    "github_projects",
    "https://github.com/example/research/issues/9",
    JSON.stringify({
      repository: "example/research",
      prNumber: 9,
      token: "PRIVATE_TOKEN",
    }),
    "2026-09-09T00:00:00Z",
    "2026-09-10T00:00:00Z",
    "issue",
  );
  const store = new Store(join(dir, "target", "desk.db"));
  const service = new Service(store);
  t.after(() => {
    store.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, source, db, store, service, backupDir: join(dir, "backup") };
}
const sourceBytes = (f) =>
  Object.fromEntries(
    [
      "index.db",
      "projects/source-project.db",
      "projects/source-project.db-wal",
    ].map((p) => [p, readFileSync(join(f.source, p)).toString("hex")]),
  );

test("preview and import reconcile tasks plus backlog from unchanged read-only WAL sources", async (t) => {
  const f = fixture(t);
  const before = sourceBytes(f);
  const preview = await previewKangentic(f.source);
  assert.equal(preview.counts.projects, 1);
  assert.equal(preview.counts.tasks, 4);
  assert.equal(preview.counts.backlogItems, 1);
  assert.equal(preview.counts.sessions, 2);
  assert.equal(f.store.list("ticket").length, 0);
  const result = await importKangentic(f.service, f.source, {
    backupDir: f.backupDir,
  });
  assert.deepEqual(sourceBytes(f), before);
  assert.equal(f.store.list("ticket").length, 5);
  assert.equal(result.reconciliation.sourceTickets, 5);
  assert.equal(result.reconciliation.mappedTickets, 5);
  assert.equal(result.reconciliation.matches, true);
  assert.ok(result.backup.manifest);
  assert.equal(statSync(result.backup.manifest).mode & 0o777, 0o600);
  assert.ok(result.warnings.some((x) => x.code === "ATTACHMENT_COPY_PENDING"));
  assert.ok(result.warnings.some((x) => x.code === "UNSUPPORTED_FIELDS"));
});

test("re-import keeps stable source mappings and never overwrites local edits or releases claims", async (t) => {
  const f = fixture(t);
  const first = await importKangentic(f.service, f.source, {
    backupDir: f.backupDir,
  });
  const running = f.store
    .list("ticket")
    .find((x) => x.title === "Running task");
  f.service.updateTicket(running.id, {
    version: running.version,
    title: "Local edit",
  });
  const version = f.store.get("ticket", running.id).version;
  const second = await importKangentic(f.service, f.source, {
    backupDir: f.backupDir,
  });
  assert.equal(f.store.list("project").length, 1);
  assert.equal(f.store.list("stage").length, 5);
  assert.equal(f.store.list("ticket").length, 5);
  assert.deepEqual(second.mappings, first.mappings);
  assert.equal(f.store.get("ticket", running.id).title, "Local edit");
  assert.equal(f.store.get("ticket", running.id).version, version);
  assert.equal(f.store.active(running.id).releasedAt, null);
  assert.equal(second.created.tickets, 0);
});

test("owners, held stages, blockers and external sessions survive without automatic dispatch", async (t) => {
  const f = fixture(t);
  let launched = 0;
  f.service.on("autostart", () => launched++);
  await importKangentic(f.service, f.source, { backupDir: f.backupDir });
  const tickets = f.service.state().tickets;
  const running = tickets.find((x) => x.title === "Running task");
  const paused = tickets.find((x) => x.title === "Paused task");
  assert.equal(running.ownerId, "codex");
  assert.deepEqual(running.labels, ["owner:codex", "blocked:dependency"]);
  assert.ok(running.blockedReason);
  assert.equal(running.execution.sessionId, "native-session");
  assert.equal(running.execution.external, true);
  assert.equal(running.execution.releasedAt, null);
  assert.equal(paused.ownerId, "claude");
  assert.equal(f.store.get("stage", paused.stageId).role, "backlog");
  assert.equal(paused.execution.sessionId, "native-paused");
  assert.equal(paused.execution.releasedAt, null);
  assert.equal(
    tickets.find((x) => x.title === "Planned work").ownerId,
    "arkcli",
  );
  assert.equal(
    tickets.find((x) => x.title === "Planned work").priority,
    "urgent",
  );
  for (const title of ["Unknown owner", "Ambiguous owner"]) {
    const ticket = tickets.find((x) => x.title === title);
    assert.equal(ticket.ownerId, null);
    assert.ok(ticket.blockedReason);
    assert.throws(() =>
      f.service.claim(ticket.id, { agentId: "codex", sessionId: "new" }),
    );
  }
  assert.ok(f.store.list("stage").every((x) => x.autoStart === false));
  assert.equal(launched, 0);
  assert.equal(
    f.store.db.prepare("SELECT count(*) n FROM sync_jobs").get().n,
    0,
  );
});

test("repeat import routes new Parked and unknown-stage tasks without reviving retired stages", async (t) => {
  const f = fixture(t);
  await importKangentic(f.service, f.source, { backupDir: f.backupDir });
  // Recreate the deployed pre-upgrade stage mapping before the startup migration.
  const paused = f.store
    .list("ticket")
    .find((ticket) => ticket.title === "Paused task");
  f.store.put("stage", {
    id: "retired-parked",
    projectId: paused.projectId,
    name: "Parked",
    role: "parked",
    position: 5,
    autoStart: false,
  });
  f.store.put("ticket", { ...paused, stageId: "retired-parked" });
  const record = f.store
    .list("migration-record")
    .find(
      (record) =>
        record.mapping?.sourceKind === "stage" &&
        record.mapping.originalId === "parked",
    );
  f.store.put("migration-record", {
    ...record,
    mapping: { ...record.mapping, targetId: "retired-parked" },
  });
  migrateWorkflow(f.store);
  const claims = f.store.db
    .prepare("SELECT * FROM executions ORDER BY id")
    .all();
  const stageIds = f.store
    .list("stage")
    .map((s) => s.id)
    .sort();
  f.db
    .exec(`INSERT INTO swimlanes VALUES('unknown-stage','Waiting approval',9,'mystery','#87909b',1,NULL,NULL);
    INSERT INTO tasks(id,title,description,swimlane_id,labels,agent) VALUES('new-parked','New parked','kept','parked','["owner:codex"]','codex');
    INSERT INTO tasks(id,title,description,swimlane_id,labels,agent) VALUES('new-unknown','New unknown','kept','unknown-stage','["owner:codex"]','codex');`);
  const result = await importKangentic(f.service, f.source, {
    backupDir: f.backupDir,
  });
  assert.equal(f.store.list("stage").length, 5);
  assert.deepEqual(
    f.store
      .list("stage")
      .map((s) => s.id)
      .sort(),
    stageIds,
  );
  assert.equal(f.store.list("ticket").length, 7);
  for (const title of ["New parked", "New unknown"]) {
    const ticket = f.store.list("ticket").find((t) => t.title === title);
    assert.equal(f.store.get("stage", ticket.stageId).role, "backlog");
  }
  assert.match(
    f.store.list("ticket").find((t) => t.title === "New unknown").blockedReason,
    /stage needs reconciliation/i,
  );
  assert.ok(result.warnings.some((w) => w.code === "UNMAPPED_STAGE_ROLE"));
  for (const record of f.store.list("migration-record"))
    if (record.mapping?.targetKind === "stage")
      assert.ok(f.store.get("stage", record.mapping.targetId));
  assert.deepEqual(
    f.store.db.prepare("SELECT * FROM executions ORDER BY id").all(),
    claims,
  );
});

test("source records retain allowlisted routes and attachment references but no secret source fields", async (t) => {
  const f = fixture(t);
  await importKangentic(f.service, f.source, { backupDir: f.backupDir });
  const all =
    f.store.db
      .prepare("SELECT data FROM records")
      .all()
      .map((r) => r.data)
      .join("\n") +
    f.store.db
      .prepare("SELECT data FROM executions")
      .all()
      .map((r) => r.data)
      .join("\n");
  assert.ok(all.includes("model-kept"));
  assert.ok(all.includes("/source/specs/plan.md"));
  assert.ok(all.includes("item-id"));
  for (const marker of [
    "PRIVATE_PROMPT",
    "PRIVATE_COMMAND",
    "PRIVATE_TRANSCRIPT",
    "PRIVATE_TOKEN",
    "PRIVATE_UNRECOGNIZED",
  ])
    assert.equal(all.includes(marker), false, marker);
  const ticket = f.store.list("ticket").find((x) => x.title === "Planned work");
  assert.equal(ticket.github.number, 9);
  assert.equal(ticket.github.syncState, "imported");
  assert.equal(ticket.github.dirty, false);
  assert.equal(
    f.store.list("ticket").find((x) => x.title === "Running task").github,
    null,
    "PR references are not issue links",
  );
  assert.equal(f.store.list("project")[0].repo, "example/research");
});

test("source traversal and symlink escapes are rejected before importing anything", async (t) => {
  const f = fixture(t, { projectId: "../outside" });
  await assert.rejects(previewKangentic(f.source), /project.*id|unsafe/i);
  assert.equal(f.store.list("project").length, 0);
  const other = join(f.dir, "other");
  mkdirSync(other);
  symlinkSync(join(f.source, "index.db"), join(other, "index.db"));
  await assert.rejects(previewKangentic(other), /outside|symlink|source/i);
});

test("multiple unresolved sessions remain held together without fabricating a release", async (t) => {
  const f = fixture(t);
  f.db.exec(
    "INSERT INTO sessions VALUES('old-suspended','running-task','native-old','suspended','2026-09-08T00:00:00Z','2026-09-09T00:00:00Z',NULL,'/source/old','PRIVATE_PROMPT','PRIVATE_COMMAND')",
  );
  const result = await importKangentic(f.service, f.source, {
    backupDir: f.backupDir,
  });
  const ticket = f.service
    .state()
    .tickets.find((x) => x.title === "Running task");
  assert.equal(ticket.execution.sessionId, "native-session");
  assert.equal(ticket.execution.releasedAt, null);
  assert.equal(
    result.mappings.filter((x) => x.sourceKind === "session").length,
    3,
  );
  assert.ok(
    result.warnings.some((x) => x.code === "MULTIPLE_UNRELEASED_SESSIONS"),
  );
  assert.ok(
    ticket.execution.heldSessions.some(
      (x) => x.sessionId === "native-old" && x.releasedAt === null,
    ),
  );
});

test("backup aliases cannot create directories inside the source", async (t) => {
  const f = fixture(t);
  const alias = join(f.dir, "alias");
  symlinkSync(f.source, alias);
  await assert.rejects(
    importKangentic(f.service, f.source, {
      backupDir: join(alias, "new-backup"),
    }),
    /source/i,
  );
  assert.equal(existsSync(join(f.source, "new-backup")), false);
});

test("a target failure rolls back every imported record while retaining the consistent backup", async (t) => {
  const f = fixture(t);
  f.store.saveExecution = () => {
    throw new Error("Target failure");
  };
  await assert.rejects(
    importKangentic(f.service, f.source, { backupDir: f.backupDir }),
    /Target failure/,
  );
  assert.equal(f.store.list("ticket").length, 0);
  assert.equal(f.store.list("project").length, 0);
  assert.equal(f.store.list("migration-record").length, 0);
});

test("unexpected source views are refused instead of evaluated", async (t) => {
  const f = fixture(t);
  f.db.exec(
    "DROP TABLE sessions; CREATE VIEW sessions AS SELECT 'synthetic' AS id,'PRIVATE_PROMPT' AS prompt",
  );
  await assert.rejects(previewKangentic(f.source), /Unsupported source table/);
  assert.equal(f.store.list("ticket").length, 0);
});

test("a missing current session remains held alongside a known suspended source session", async (t) => {
  const f = fixture(t);
  f.db.exec(
    "UPDATE tasks SET session_id='missing-native-session' WHERE id='paused-task'",
  );
  const before = sourceBytes(f);
  await importKangentic(f.service, f.source, { backupDir: f.backupDir });
  const ticket = f.service
    .state()
    .tickets.find((x) => x.title === "Paused task");
  const partial = f.service.reconcileExternal(ticket.execution.id, {
    sessionId: "native-paused",
    summary: "Known suspended source session checkpointed",
    stopped: true,
  });
  assert.equal(
    partial.releasedAt,
    null,
    "missing current source handle must still reserve the ticket",
  );
  assert.ok(
    partial.heldSessions.some(
      (x) => x.sessionId === "missing-native-session" && x.releasedAt === null,
    ),
  );
  await importKangentic(f.service, f.source, { backupDir: f.backupDir });
  assert.equal(f.store.active(ticket.id).id, ticket.execution.id);
  const finished = f.service.reconcileExternal(ticket.execution.id, {
    sessionId: "missing-native-session",
    summary: "Missing source handle inspected and explicitly stopped",
    stopped: true,
  });
  assert.ok(finished.releasedAt);
  await importKangentic(f.service, f.source, { backupDir: f.backupDir });
  assert.equal(
    f.store.active(ticket.id),
    null,
    "re-import cannot reopen a reconciled execution",
  );
  assert.deepEqual(sourceBytes(f), before);
});
