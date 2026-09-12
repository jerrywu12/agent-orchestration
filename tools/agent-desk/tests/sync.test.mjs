import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../server/store.mjs";
import { Service } from "../server/service.mjs";
import { SyncManager } from "../server/sync.mjs";
function fixture(t) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const service = new Service(store);
  const p = service.createProject({ name: "Sync", repo: "owner/repo" });
  const remote = {
    repo: p.repo,
    number: 1,
    nodeId: "I_1",
    url: "https://github.com/owner/repo/issues/1",
    title: "Remote task",
    description: "Original",
    labels: [],
    state: "open",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  const client = {
    listIssues: async () => [{ ...remote }],
    check: async () => ({ available: true }),
    getIssue: async () => ({ ...remote }),
    updateIssue: async (repo, number, fields) => Object.assign(remote, fields),
    createIssue: async (repo, ticket) => ({
      ...remote,
      title: ticket.title,
      description: ticket.description,
    }),
  };
  const sync = new SyncManager(service, { client, auto: false });
  return { store, service, p, remote, client, sync };
}
test("sync imports once, pushes local edit and never treats closed issue as delivered", async (t) => {
  const { service, p, remote, sync } = fixture(t);
  await sync.syncProject(p.id);
  await sync.syncProject(p.id);
  let a = service.state().tickets[0];
  assert.equal(service.state().tickets.length, 1);
  service.updateTicket(a.id, { version: a.version, title: "Local change" });
  await sync.syncProject(p.id);
  assert.equal(remote.title, "Local change");
  remote.state = "closed";
  remote.title = "Closed remotely";
  await sync.syncProject(p.id);
  a = service.getTicket(a.id);
  assert.equal(a.title, "Closed remotely");
  assert.notEqual(
    service.state().stages.find((s) => s.id === a.stageId).role,
    "done",
  );
});
test("concurrent local and remote edits retain both and pending jobs survive retryable errors", async (t) => {
  const { service, store, p, remote, client, sync } = fixture(t);
  await sync.syncProject(p.id);
  let a = service.state().tickets[0];
  service.updateTicket(a.id, { version: a.version, title: "Local" });
  remote.title = "Remote";
  await sync.syncProject(p.id);
  a = service.getTicket(a.id);
  assert.equal(a.title, "Local");
  assert.equal(a.github.syncState, "conflict");
  assert.ok(a.github.conflict);
  sync.resolve(a.id, "local");
  client.updateIssue = async () => {
    throw Object.assign(Error("rate limited"), {
      retryable: true,
      retryAfter: 60,
    });
  };
  await sync.syncProject(p.id);
  assert.ok(
    store.db.prepare("SELECT * FROM sync_jobs WHERE ticket_id=?").get(a.id),
  );
  assert.equal(service.getTicket(a.id).title, "Local");
});
function board(f) {
  const stages = f.service.state().stages;
  const backlog = stages.find((s) => s.role === "backlog"),
    active = stages.find((s) => s.role === "active"),
    review = stages.find((s) => s.role === "review");
  f.service.updateProject(f.p.id, {
    githubProjectNumber: 1,
    stageMapping: {
      [backlog.id]: "TODO",
      [active.id]: "DOING",
      [review.id]: "REVIEW",
    },
  });
  let option = "TODO";
  f.client.getProject = async () => ({
    id: "P_1",
    statusFieldId: "F_1",
    statusOptions: [],
    url: "https://github.com/users/owner/projects/1",
  });
  f.client.listProjectItems = async () => [
    {
      id: "ITEM_1",
      issue: { nodeId: "I_1" },
      status: { optionId: option, name: option },
    },
  ];
  f.client.setProjectStatus = async (p, i, f, value) => {
    option = value;
    return { itemId: "ITEM_1" };
  };
  return {
    backlog,
    active,
    review,
    setOption: (v) => (option = v),
    getOption: () => option,
  };
}
test("Project failure retains durable stage intent and pull-only cannot erase it", async (t) => {
  const f = fixture(t);
  const b = board(f);
  await f.sync.syncProject(f.p.id);
  let a = f.service.state().tickets[0];
  f.service.updateTicket(a.id, { version: a.version, stageId: b.active.id });
  await f.sync.syncProject(f.p.id, { direction: "pull" });
  f.client.setProjectStatus = async () => {
    throw Object.assign(Error("Project denied"), { retryable: false });
  };
  await f.sync.syncProject(f.p.id);
  a = f.service.getTicket(a.id);
  assert.equal(a.stageId, b.active.id);
  assert.ok(
    f.store.db.prepare("SELECT * FROM sync_jobs WHERE ticket_id=?").get(a.id),
  );
});
test("choosing local for a Project conflict resolves it on next round trip", async (t) => {
  const f = fixture(t);
  const b = board(f);
  await f.sync.syncProject(f.p.id);
  let a = f.service.state().tickets[0];
  f.service.updateTicket(a.id, { version: a.version, stageId: b.active.id });
  b.setOption("REVIEW");
  await f.sync.syncProject(f.p.id);
  assert.equal(f.service.getTicket(a.id).github.syncState, "conflict");
  f.sync.resolve(a.id, "local");
  await f.sync.syncProject(f.p.id);
  assert.equal(b.getOption(), "DOING");
  assert.equal(f.service.getTicket(a.id).github.syncState, "synced");
});
test("removing remote owner does not restore it later", async (t) => {
  const f = fixture(t);
  f.remote.labels = ["owner:codex"];
  await f.sync.syncProject(f.p.id);
  f.remote.labels = [];
  await f.sync.syncProject(f.p.id);
  assert.equal(f.service.state().tickets[0].ownerId, null);
  await f.sync.syncProject(f.p.id);
  assert.deepEqual(f.remote.labels, []);
});
test("fresh connector conflict keeps actual fresh remote snapshot", async (t) => {
  const f = fixture(t);
  await f.sync.syncProject(f.p.id);
  const a = f.service.state().tickets[0];
  f.service.updateTicket(a.id, { version: a.version, title: "Local" });
  f.client.updateIssue = async () => {
    throw Object.assign(Error("conflict"), {
      code: "CONFLICT",
      conflict: { remote: { ...f.remote, title: "Fresh remote" } },
    });
  };
  await f.sync.syncProject(f.p.id);
  assert.equal(
    f.service.getTicket(a.id).github.conflict.remote.title,
    "Fresh remote",
  );
});
test("publish intent persists before network and marker reconciles concurrent import without duplicate", async (t) => {
  const f = fixture(t);
  const a = f.service.createTicket({
    projectId: f.p.id,
    title: "Publish this",
    ownerId: "codex",
  });
  let release;
  const hold = new Promise((r) => (release = r));
  f.client.createIssue = async () => {
    await hold;
    return { ...f.remote, title: a.title, agentDeskId: a.id };
  };
  f.client.listIssues = async () => [
    { ...f.remote, title: a.title, agentDeskId: a.id },
  ];
  const sending = f.sync.publish(a.id);
  assert.ok(f.store.get("publish-intent", a.id));
  await f.sync.syncProject(f.p.id);
  release();
  await sending;
  assert.equal(f.service.state().tickets.length, 1);
  assert.equal(f.service.getTicket(a.id).github.number, 1);
});

test("failed first import retries from durable project intent after reopening storage without ticket jobs", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "agent-desk-project-retry-"));
  const database = join(directory, "desk.db");
  let store = new Store(database);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  let service = new Service(store);
  const project = service.createProject({
    name: "First import",
    repo: "owner/repo",
  });
  const remote = {
    repo: project.repo,
    number: 1,
    nodeId: "I_1",
    url: "https://github.com/owner/repo/issues/1",
    title: "Imported after retry",
    description: "",
    labels: [],
    state: "open",
  };
  let calls = 0;
  let unavailable = true;
  const client = {
    listIssues: async () => {
      calls++;
      if (unavailable)
        throw Object.assign(Error("Initial rate limit"), {
          code: "RATE_LIMITED",
          retryable: true,
          retryAfterMs: 60000,
        });
      return [remote];
    },
  };
  const sync = new SyncManager(service, { client, auto: false });
  const started = Date.now();
  const failed = await sync.syncProject(project.id, { direction: "pull" });
  assert.equal(failed.lastSyncAt, null);
  assert.equal(store.list("ticket").length, 0);
  assert.equal(
    store.db.prepare("SELECT count(*) AS n FROM sync_jobs").get().n,
    0,
  );
  const scheduled = store.get("project-sync-intent", project.id);
  // Make the persisted deadline due without wall-clock sleeps. The old code has no intent.
  if (scheduled)
    store.put("project-sync-intent", {
      ...scheduled,
      retryAt: new Date(Date.now() - 1).toISOString(),
    });
  store.close();
  store = new Store(database);
  service = new Service(store);
  unavailable = false;
  const resumed = new SyncManager(service, { client, auto: false });
  await resumed.tick();
  assert.equal(
    calls,
    2,
    "an empty project must retry its first failed import after restart",
  );
  assert.equal(service.state().tickets[0].title, remote.title);
  assert.equal(scheduled.direction, "pull");
  assert.equal(scheduled.attempts, 1);
  assert.equal(scheduled.errorCode, "RATE_LIMITED");
  assert.ok(Date.parse(scheduled.retryAt) >= started + 60000);
  assert.equal(failed.pending, 1);
  assert.equal(failed.retryable, true);
  assert.equal(failed.attempts, 1);
  assert.equal(store.get("project-sync-intent", project.id), null);
  assert.equal(store.get("sync", project.id).pending, 0);
  assert.equal(store.get("sync", project.id).retryAt, null);
});

test("project retry backoff takes precedence over due ticket jobs and expired polling", async (t) => {
  const f = fixture(t);
  await f.sync.syncProject(f.p.id);
  const ticket = f.service.state().tickets[0];
  f.service.updateTicket(ticket.id, {
    version: ticket.version,
    title: "Keep local edit",
  });
  f.store.put("sync", {
    ...f.store.get("sync", f.p.id),
    lastSyncAt: "2000-01-01T00:00:00.000Z",
  });
  let calls = 0;
  let unavailable = true;
  let writes = 0;
  f.client.listIssues = async () => {
    calls++;
    if (unavailable)
      throw Object.assign(Error("Temporarily offline"), {
        code: "NETWORK",
        retryable: true,
        retryAfterMs: 5000,
      });
    return [{ ...f.remote }];
  };
  f.client.updateIssue = async () => {
    writes++;
    return f.remote;
  };
  await f.sync.syncProject(f.p.id, { direction: "pull" });
  const resumed = new SyncManager(f.service, { client: f.client, auto: false });
  await resumed.tick();
  assert.equal(
    calls,
    1,
    "ticket jobs and polling must not bypass project backoff",
  );
  let intent = f.store.get("project-sync-intent", f.p.id);
  assert.equal(intent.direction, "pull");
  f.store.put("project-sync-intent", {
    ...intent,
    retryAt: new Date(Date.now() - 1).toISOString(),
  });
  const secondStart = Date.now();
  await resumed.tick();
  intent = f.store.get("project-sync-intent", f.p.id);
  assert.equal(intent.attempts, 2);
  assert.ok(
    Date.parse(intent.retryAt) >= secondStart + 10000,
    "second retry must use exponential backoff",
  );
  unavailable = false;
  f.store.put("project-sync-intent", {
    ...intent,
    retryAt: new Date(Date.now() - 1).toISOString(),
  });
  await resumed.tick();
  assert.equal(calls, 3);
  assert.equal(writes, 0, "retrying pull must not publish local edits");
  assert.equal(f.service.getTicket(ticket.id).title, "Keep local edit");
  assert.equal(f.service.getTicket(ticket.id).github.dirty, true);
});

test("nonretryable project errors remain blocked across manager restart until explicit manual retry", async (t) => {
  const f = fixture(t);
  let calls = 0;
  let denied = true;
  f.client.listIssues = async () => {
    calls++;
    if (denied)
      throw Object.assign(Error("Repository permission denied"), {
        code: "FORBIDDEN",
        retryable: false,
      });
    return [{ ...f.remote }];
  };
  await f.sync.syncProject(f.p.id);
  const blocked = f.store.get("project-sync-intent", f.p.id);
  // Old successful polling metadata must not bypass the permission stop either.
  f.store.put("sync", {
    ...f.store.get("sync", f.p.id),
    lastSyncAt: "2000-01-01T00:00:00.000Z",
  });
  const resumed = new SyncManager(f.service, { client: f.client, auto: false });
  await resumed.tick();
  await resumed.tick();
  assert.equal(
    calls,
    1,
    "automatic polling must not retry permission failures",
  );
  assert.equal(blocked.state, "error");
  assert.equal(blocked.retryable, false);
  assert.equal(blocked.errorCode, "FORBIDDEN");
  denied = false;
  resumed.enqueueProject(f.p.id, { direction: "pull" });
  assert.equal(f.store.get("project-sync-intent", f.p.id).attempts, 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.equal(f.service.state().tickets.length, 1);
  assert.equal(f.store.get("project-sync-intent", f.p.id), null);
});

test("project retry budget stops repeated failures and manual retry starts a fresh budget", async (t) => {
  const f = fixture(t);
  let calls = 0;
  let offline = true;
  f.client.listIssues = async () => {
    calls++;
    if (offline)
      throw Object.assign(Error("Offline"), {
        code: "NETWORK",
        retryable: true,
      });
    return [];
  };
  await f.sync.syncProject(f.p.id);
  for (let attempt = 1; attempt < 6; attempt++) {
    const intent = f.store.get("project-sync-intent", f.p.id);
    assert.ok(intent, "every failed project read needs a durable retry record");
    f.store.put("project-sync-intent", {
      ...intent,
      retryAt: new Date(Date.now() - 1).toISOString(),
    });
    await f.sync.tick();
  }
  const exhausted = f.store.get("project-sync-intent", f.p.id);
  assert.equal(exhausted.state, "error");
  assert.equal(exhausted.attempts, 6);
  assert.equal(exhausted.retryExhausted, true);
  await f.sync.tick();
  assert.equal(calls, 6);
  offline = false;
  f.sync.enqueueProject(f.p.id);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 7);
  assert.equal(f.store.get("project-sync-intent", f.p.id), null);
});

test("project intent is durable before the first provider response settles", async (t) => {
  const f = fixture(t);
  let release;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  f.client.listIssues = async () => {
    await hold;
    return [];
  };
  const running = f.sync.syncProject(f.p.id, { direction: "pull" });
  const intent = f.store.get("project-sync-intent", f.p.id);
  release();
  await running;
  assert.ok(
    intent,
    "a crash during the initial request must retain the project sync intent",
  );
  assert.equal(intent.state, "pending");
  assert.equal(intent.attempts, 1);
  assert.equal(intent.direction, "pull");
  assert.ok(intent.lastAttemptAt);
  assert.ok(intent.retryAt);
});

for (const labels of [["owner:unknown", "keep-me"], ["owner:codex", "owner:claude", "keep-me"]]) {
  test(`import preserves unresolved routing ${labels.filter(label => label.startsWith("owner:")).join(", ")} without outgoing edits`, async (t) => {
    const f = fixture(t);
    f.remote.labels = [...labels];
    let writes = 0;
    f.client.updateIssue = async (repo, number, fields) => { writes++; return Object.assign(f.remote, fields); };
    await f.sync.syncProject(f.p.id);
    await f.sync.syncProject(f.p.id);
    const ticket = f.service.state().tickets[0];
    assert.equal(writes, 0, "an unmapped local owner is a projection, not permission to delete routing labels");
    assert.deepEqual([...f.remote.labels].sort(), [...labels].sort());
    assert.deepEqual([...ticket.labels].sort(), [...labels].sort());
    assert.equal(ticket.ownerId, null);
    assert.ok(ticket.blockedReason, "unresolved GitHub routing must retain a visible assignment hold");
    assert.equal(ticket.github.dirty, false);
    assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM sync_jobs").get().n, 0);
  });
}

test("an unrelated local title edit preserves unsupported remote owner labels", async (t) => {
  const f = fixture(t);
  f.remote.labels = ["owner:unknown", "keep-me"];
  const writes = [];
  f.client.updateIssue = async (repo, number, fields) => { writes.push(structuredClone(fields)); return Object.assign(f.remote, fields); };
  await f.sync.syncProject(f.p.id);
  const ticket = f.service.state().tickets[0];
  f.service.updateTicket(ticket.id, { version: ticket.version, title: "User changed the title" });
  await f.sync.syncProject(f.p.id);
  assert.equal(writes.length, 1);
  assert.equal(f.remote.title, "User changed the title");
  assert.deepEqual([...f.remote.labels].sort(), ["keep-me", "owner:unknown"]);
  assert.equal(f.service.getTicket(ticket.id).ownerId, null);
  assert.ok(f.service.getTicket(ticket.id).blockedReason);
});

test("explicit assignment replaces unsupported routing and explicit owner removal still round-trips", async (t) => {
  const f = fixture(t);
  f.remote.labels = ["owner:unknown", "keep-me"];
  await f.sync.syncProject(f.p.id);
  let ticket = f.service.state().tickets[0];
  f.service.updateTicket(ticket.id, { version: ticket.version, ownerId: "codex" });
  await f.sync.syncProject(f.p.id);
  ticket = f.service.getTicket(ticket.id);
  assert.deepEqual([...f.remote.labels].sort(), ["keep-me", "owner:codex"]);
  assert.equal(ticket.ownerId, "codex");
  assert.equal(ticket.blockedReason, "", "a resolved managed assignment hold must clear");
  f.service.updateTicket(ticket.id, { version: ticket.version, ownerId: null });
  await f.sync.syncProject(f.p.id);
  await f.sync.syncProject(f.p.id);
  assert.deepEqual(f.remote.labels, ["keep-me"]);
  assert.equal(f.service.getTicket(ticket.id).ownerId, null);
});

test("explicit label resolution can select one owner from ambiguous imported routing", async (t) => {
  const f = fixture(t);
  f.remote.labels = ["owner:codex", "owner:claude", "keep-me"];
  await f.sync.syncProject(f.p.id);
  const ticket = f.service.state().tickets[0];
  f.service.updateTicket(ticket.id, { version: ticket.version, labels: ["keep-me", "owner:claude"] });
  await f.sync.syncProject(f.p.id);
  assert.deepEqual([...f.remote.labels].sort(), ["keep-me", "owner:claude"]);
  assert.equal(f.service.getTicket(ticket.id).ownerId, "claude");
  assert.equal(f.service.getTicket(ticket.id).blockedReason, "");
});

test("ownership label edits cannot bypass an active executor's checkpointed handoff", async (t) => {
  const f = fixture(t);
  f.remote.labels = ["owner:codex", "keep-me"];
  await f.sync.syncProject(f.p.id);
  let ticket = f.service.state().tickets[0];
  const active = f.service.state().stages.find(stage => stage.role === "active");
  f.service.updateTicket(ticket.id, { version: ticket.version, stageId: active.id });
  await f.sync.syncProject(f.p.id);
  f.service.claim(ticket.id, { agentId: "codex", sessionId: "existing-executor" });
  ticket = f.service.getTicket(ticket.id);
  f.service.updateTicket(ticket.id, { version: ticket.version, labels: ["keep-me", "owner:claude"] });
  let writes = 0;
  f.client.updateIssue = async () => { writes++; return f.remote; };
  await f.sync.syncProject(f.p.id);
  assert.equal(writes, 0);
  assert.equal(f.service.getTicket(ticket.id).github.syncState, "conflict");
  assert.equal(f.store.active(ticket.id).agentId, "codex");
  assert.deepEqual(f.remote.labels, ["owner:codex", "keep-me"]);
});

test("a later unsupported remote owner remains visible without overwriting an unrelated blocker", async (t) => {
  const f = fixture(t);
  f.remote.labels = ["owner:codex", "keep-me"];
  await f.sync.syncProject(f.p.id);
  let ticket = f.service.state().tickets[0];
  f.service.updateTicket(ticket.id, { version: ticket.version, blockedReason: "Waiting on a separate dependency" });
  await f.sync.syncProject(f.p.id);
  f.remote.labels = ["owner:unknown", "keep-me"];
  let writes = 0;
  f.client.updateIssue = async (repo, number, fields) => { writes++; return Object.assign(f.remote, fields); };
  await f.sync.syncProject(f.p.id);
  await f.sync.syncProject(f.p.id);
  ticket = f.service.getTicket(ticket.id);
  assert.equal(writes, 0);
  assert.equal(ticket.ownerId, null);
  assert.equal(ticket.blockedReason, "Waiting on a separate dependency");
  assert.ok(ticket.github.assignmentHold);
  assert.deepEqual([...ticket.labels].sort(), ["keep-me", "owner:unknown"]);
});

test("fresh import does not publish title normalization or reopen a closed remote issue", async (t) => {
  const f = fixture(t);
  Object.assign(f.remote, { title: "  Preserve remote title  ", description: "Body\n\n", state: "closed", labels: ["owner:unknown"] });
  let writes = 0;
  f.client.updateIssue = async (repo, number, fields) => { writes++; return Object.assign(f.remote, fields); };
  await f.sync.syncProject(f.p.id);
  const ticket = f.service.state().tickets[0];
  assert.equal(writes, 0);
  assert.equal(ticket.title, "  Preserve remote title  ");
  assert.equal(ticket.description, "Body\n\n");
  assert.equal(ticket.github.state, "closed");
  assert.notEqual(f.service.state().stages.find(stage => stage.id === ticket.stageId).role, "done");
});
