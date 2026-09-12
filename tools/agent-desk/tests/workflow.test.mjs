import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.mjs";
import {
  WORKFLOW,
  legacyRole,
  ensureProjectWorkflow,
  migrateWorkflow,
} from "../server/workflow.mjs";

function fixture(t) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  for (const projectId of ["legacy", "current"]) {
    store.put("project", {
      id: projectId,
      name: projectId,
      stageMapping: { todo: "BACKLOG" },
    });
    const names =
      projectId === "legacy"
        ? [
            ["To Do", "backlog"],
            ["Planning", "planning"],
            ["Executing", "active"],
            ["PR / Code Review", "review"],
            ["Parked", "parked"],
            ["Done", "done"],
          ]
        : [
            ["Backlog", "backlog"],
            ["Planning", "planning"],
            ["In progress", "active"],
            ["In review", "review"],
            ["Done", "done"],
          ];
    names.forEach(([name, role], position) =>
      store.put("stage", {
        id: `${projectId}-${role}`,
        projectId,
        name,
        role,
        position,
        color: "#87909b",
        autoStart: false,
      }),
    );
  }
  const github = {
    number: 3,
    nodeId: "I3",
    projectItemId: "ITEM3",
    stageIdAtSync: "legacy-parked",
    projectStatusOptionId: "OLD",
    dirty: true,
    syncState: "conflict",
    conflict: {
      remoteProjectOptionId: "REVIEW",
      local: { title: "local" },
      remote: { title: "remote" },
    },
  };
  store.put("ticket", {
    id: "held",
    projectId: "legacy",
    number: 7,
    stageId: "legacy-parked",
    ownerId: "codex",
    dependsOn: ["dependency"],
    blockedReason: "Keep this hold",
    github,
  });
  store.saveExecution({
    id: "run",
    ticketId: "held",
    agentId: "codex",
    sessionId: "native",
    releasedAt: null,
    lastSeq: 4,
    state: "external",
    heldSessions: [{ sessionId: "other", releasedAt: null }],
  });
  store.put("migration-record", {
    id: "source-stage",
    sourceId: "kangentic-fixture",
    mapping: {
      sourceKind: "stage",
      targetKind: "stage",
      targetId: "legacy-parked",
      originalId: "parked",
    },
    sourceMetadata: { name: "Parked" },
  });
  store.put("publish-intent", {
    id: "held",
    state: "pending",
    retryAt: "later",
    attempts: 2,
  });
  store.enqueue("held");
  store.db
    .prepare(
      "UPDATE sync_jobs SET state='conflict',attempts=2,error='retained'",
    )
    .run();
  return store;
}

const database = (store) => ({
  records: store.db.prepare("SELECT * FROM records ORDER BY kind,id").all(),
  jobs: store.db.prepare("SELECT * FROM sync_jobs ORDER BY ticket_id").all(),
  executions: store.db.prepare("SELECT * FROM executions ORDER BY id").all(),
});

test("canonical migration preserves surviving identities, claims and all sync intent, then is a no-op", (t) => {
  const store = fixture(t),
    before = database(store),
    ticket = store.get("ticket", "held");
  migrateWorkflow(store);
  assert.equal(store.list("stage").length, 10);
  for (const project of store.list("project")) {
    const stages = store
      .list("stage", project.id)
      .sort((a, b) => a.position - b.position);
    assert.deepEqual(
      stages.map(({ name, role }) => ({ name, role })),
      WORKFLOW.map(({ name, role }) => ({ name, role })),
    );
    assert.equal(stages[1].id, `${project.id}-planning`);
    assert.equal(stages[0].id, `${project.id}-backlog`);
    assert.equal(Object.hasOwn(project, "stageMapping"), false);
  }
  const migrated = store.get("ticket", "held");
  assert.equal(migrated.stageId, "legacy-backlog");
  assert.deepEqual(
    { ...migrated, stageId: ticket.stageId, version: ticket.version },
    ticket,
  );
  assert.deepEqual(database(store).jobs, before.jobs);
  assert.deepEqual(database(store).executions, before.executions);
  assert.equal(
    store.get("migration-record", "source-stage").mapping.targetId,
    "legacy-backlog",
  );
  assert.deepEqual(
    store.get("migration-record", "source-stage").sourceMetadata,
    { name: "Parked" },
  );
  const after = database(store);
  migrateWorkflow(store);
  assert.deepEqual(database(store), after);
});

test("migration rolls every project back on failure and retired baselines remain distinguishable", (t) => {
  const store = fixture(t),
    before = database(store),
    put = store.put.bind(store);
  store.put = (kind, value, ...rest) => {
    if (kind === "stage" && value.projectId === "current")
      throw Error("fixture failure");
    return put(kind, value, ...rest);
  };
  assert.throws(() => migrateWorkflow(store), /fixture failure/);
  assert.deepEqual(database(store), before);
});

test("missing workflow stages are created once, duplicates/unknown holds fold into Backlog safely", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  store.put("project", { id: "p" });
  store.put("stage", {
    id: "hold",
    projectId: "p",
    name: "Unrecognized hold",
    role: "unknown",
    position: 0,
    color: "#87909b",
    autoStart: true,
  });
  store.put("ticket", {
    id: "t",
    projectId: "p",
    stageId: "hold",
    blockedReason: "Existing",
    github: { number: 1, dirty: false, syncState: "synced" },
  });
  const stages = ensureProjectWorkflow(store, "p");
  assert.equal(stages.length, 5);
  assert.ok(stages.every((s) => !s.autoStart));
  assert.equal(store.get("ticket", "t").stageId, stages[0].id);
  assert.equal(store.get("ticket", "t").blockedReason, "Existing");
  assert.equal(
    store.db.prepare("SELECT count(*) AS n FROM sync_jobs").get().n,
    0,
  );
  const before = database(store);
  ensureProjectWorkflow(store, "p");
  assert.deepEqual(database(store), before);
  assert.equal(legacyRole("Planning"), "ready");
  assert.equal(legacyRole("Parked"), "backlog");
  assert.equal(legacyRole("Unexpected"), "backlog");
});
