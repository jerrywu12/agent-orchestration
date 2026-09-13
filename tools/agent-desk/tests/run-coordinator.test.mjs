import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.mjs";
import { Service } from "../server/service.mjs";
import { RunCoordinator } from "../server/run-coordinator.mjs";
const tick = () => new Promise((r) => setImmediate(r));
function fixture(
  t,
  trace = async () => ({
    tracking: "untraceable",
    processAlive: null,
    nativeSessionId: null,
    nativeThreadUrl: null,
    evidence: ["No matching native session; absence does not prove stopped."],
    reason: "Unable to trace.",
  }),
) {
  const store = new Store(":memory:"),
    service = new Service(store),
    project = service.createProject({ name: "Recovery" });
  const ticket = (extra = {}) =>
    service.createTicket({
      projectId: project.id,
      title: "Fixture",
      ownerId: "codex",
      stageId: service.state().stages.find((s) => s.role === "ready").id,
      ...extra,
    });
  const runner = {
    children: new Map(),
    start(key) {
      const t = service.require("ticket", key);
      const e = service.claim(
        key,
        { agentId: t.ownerId, sessionId: crypto.randomUUID() },
        { resolveBlockers: service.resolutionNeeded(t) },
      );
      runner.children.set(e.id, {});
      return e;
    },
  };
  const coord = new RunCoordinator(service, runner, { trace });
  t.after(() => {
    coord.close();
    store.close();
  });
  const oldClaim = (ticket) => {
    const e = service.claim(ticket.id, {
      agentId: "codex",
      sessionId: crypto.randomUUID(),
      external: true,
    });
    return store.saveExecution({
      ...e,
      heartbeatAt: new Date(Date.now() - 120000).toISOString(),
    });
  };
  return { store, service, project, ticket, runner, coord, oldClaim };
}
const confirm = (e) => ({
  executionId: e.id,
  sessionId: e.sessionId,
  expectedHeartbeatAt: e.heartbeatAt,
  confirmed: true,
  reason: "Session cannot be traced; preserve original worktree.",
});
test("bulk read model follows exact live execution progress without rewriting batch records", async (t) => {
  const f = fixture(t), ticket = f.ticket();
  const batch = f.coord.submit({ticketIds:[ticket.id],requestId:"live-progress-test",concurrency:1});
  await tick();
  const e=f.store.active(ticket.id), persisted=f.store.get("run-batch",batch.id);
  f.service.event(e.id,{agentId:e.agentId,sessionId:e.sessionId,eventId:"progress-1",seq:1,type:"progress",summary:"Verifying the acceptance tests",progress:35});
  const row=f.coord.get(batch.id).results[0];
  assert.equal(row.message,"Verifying the acceptance tests");
  assert.equal(row.telemetry.progress,35);
  assert.ok(row.telemetry.lastActivityAt);
  assert.deepEqual(f.store.get("run-batch",batch.id),persisted);
  const activityAt=row.telemetry.lastActivityAt;
  f.store.saveExecution({...f.store.execution(e.id),heartbeatAt:"2001-01-01T00:00:00.000Z"});
  f.service.event(e.id,{agentId:e.agentId,sessionId:e.sessionId,eventId:"heartbeat-2",seq:2,type:"heartbeat"});
  const next=f.coord.get(batch.id).results[0].telemetry;
  assert.equal(next.lastActivityAt,activityAt);
  assert.equal(next.stale,false);
  assert.equal(next.summary,"Verifying the acceptance tests");
});
test("stale recovery retains old work and fences old execution events with exact confirmation", async (t) => {
  const f = fixture(t),
    ticket = f.ticket(),
    old = f.oldClaim(ticket);
  const before = await f.coord.status(ticket.id);
  assert.equal(before.canTakeOver, true);
  assert.equal(before.history.length, 1);
  await assert.rejects(
    () => f.coord.takeover(ticket.id, { ...confirm(old), confirmed: false }),
    (e) => e.code === "CONFIRM_REQUIRED",
  );
  await assert.rejects(
    () =>
      f.coord.takeover(ticket.id, { ...confirm(old), executionId: "other" }),
    (e) => e.code === "EXECUTION_CHANGED",
  );
  await f.coord.takeover(ticket.id, confirm(old));
  assert.equal(f.store.active(ticket.id), null);
  assert.equal(f.store.execution(old.id).state, "revoked");
  const replacement = f.runner.start(ticket.id);
  assert.notEqual(replacement.id, old.id);
  assert.throws(
    () =>
      f.service.event(old.id, {
        agentId: old.agentId,
        sessionId: old.sessionId,
        eventId: "late",
        seq: 1,
        type: "progress",
        summary: "late",
      }),
    (e) => e.code === "EXECUTION_FINISHED",
  );
  assert.equal(f.store.active(ticket.id).id, replacement.id);
  assert.ok(f.store.activities().some((a) => a.kind === "claim_revoked"));
});
test("verified live or recently reporting sessions cannot be taken over", async (t) => {
  const f = fixture(t, async () => ({
    tracking: "process",
    processAlive: true,
    evidence: ["Exact process identity verified."],
  }));
  const old = f.oldClaim(f.ticket());
  assert.equal((await f.coord.status(old.ticketId)).canTakeOver, false);
  await assert.rejects(
    () => f.coord.takeover(old.ticketId, confirm(old)),
    (e) => e.code === "SESSION_TRACKED",
  );
  const g = fixture(t);
  const fresh = g.service.claim(g.ticket().id, {
    agentId: "codex",
    sessionId: "fresh",
  });
  await assert.rejects(
    () => g.coord.takeover(fresh.ticketId, confirm(fresh)),
    (e) => e.code === "SESSION_TRACKED",
  );
});
test("heartbeat changing while trace awaits refuses takeover", async (t) => {
  let release;
  const waiting = new Promise((r) => (release = r));
  const f = fixture(t, async () => {
    await waiting;
    return { tracking: "untraceable", processAlive: null, evidence: [] };
  });
  const old = f.oldClaim(f.ticket());
  const pending = f.coord.takeover(old.ticketId, confirm(old));
  f.service.event(old.id, {
    agentId: old.agentId,
    sessionId: old.sessionId,
    eventId: "new",
    seq: 1,
    type: "progress",
    summary: "I am working.",
  });
  release();
  await assert.rejects(
    () => pending,
    (e) => e.code === "EXECUTION_CHANGED",
  );
  assert.equal(f.store.active(old.ticketId).id, old.id);
});
test("bulk archive is partial and refuses active reservations", (t) => {
  const f = fixture(t),
    a = f.ticket(),
    b = f.ticket(),
    c = f.ticket();
  f.service.updateTicket(c.id, { version: c.version, archived: true });
  f.oldClaim(b);
  const result = f.coord.archive({ ticketIds: [a.id, b.id, c.id, "missing"] });
  assert.deepEqual(
    result.results.map((r) => r.status),
    ["archived", "failed", "skipped", "failed"],
  );
  assert.equal(f.service.getTicket(a.id).archived, true);
  assert.equal(f.service.getTicket(b.id).archived, false);
  assert.throws(
    () => f.coord.archive({ ticketIds: [] }),
    (e) => e.code === "VALIDATION",
  );
});
test("bulk queue bounds concurrency, resolves blocked work and surfaces stale reservations", async (t) => {
  const f = fixture(t),
    a = f.ticket({ blockedReason: "dependency" }),
    b = f.ticket(),
    c = f.ticket(),
    held = f.ticket(),
    done = f.ticket({
      stageId: f.service.state().stages.find((s) => s.role === "done").id,
    });
  f.oldClaim(held);
  const input = {
    ticketIds: [a.id, b.id, c.id, held.id, done.id],
    concurrency: 2,
    requestId: "request-fixture-1",
  };
  const batch = f.coord.submit(input);
  assert.equal(f.coord.submit(input).id, batch.id);
  assert.throws(
    () => f.coord.submit({ ...input, concurrency: 3 }),
    (e) => e.code === "REQUEST_CONFLICT",
  );
  await tick();
  let rows = f.coord.get(batch.id).results;
  assert.deepEqual(
    rows.map((r) => r.status),
    ["running", "running", "queued", "needs_takeover", "skipped"],
  );
  assert.equal(f.store.active(a.id).purpose, "resolve_blockers");
  assert.equal(f.runner.children.size, 2);
  const run = f.store.active(a.id);
  f.runner.children.delete(run.id);
  f.service.event(run.id, {
    agentId: "codex",
    sessionId: run.sessionId,
    eventId: "finish",
    seq: 1,
    type: "checkpoint",
    summary: "Blocked checkpoint",
  });
  await tick();
  rows = f.coord.get(batch.id).results;
  assert.equal(rows[0].status, "checkpointed");
  assert.equal(rows[2].status, "running");
  assert.equal(f.runner.children.size, 2);
});
test("overlapping batches do not spawn a second owner; restart does not replay queued jobs", async (t) => {
  const f = fixture(t),
    a = f.ticket(),
    b = f.ticket();
  const one = f.coord.submit({
    ticketIds: [a.id, b.id],
    concurrency: 1,
    requestId: "request-first",
  });
  const two = f.coord.submit({
    ticketIds: [a.id],
    concurrency: 1,
    requestId: "request-second",
  });
  await tick();
  assert.equal(f.coord.get(two.id).results[0].status, "already_running");
  assert.equal(f.runner.children.size, 1);
  f.coord.close();
  const restart = new RunCoordinator(f.service, f.runner);
  t.after(() => restart.close());
  assert.equal(restart.get(one.id).state, "complete");
  assert.match(restart.get(one.id).results[1].message, /restarted/);
});

test("HTTP exposes recovery and batch contracts only to administrators", async (t) => {
  const f = fixture(t),
    ticket = f.ticket(),
    old = f.oldClaim(ticket);
  const { createAppServer } = await import("../server/http.mjs");
  const server = createAppServer({
    service: f.service,
    runner: { ...f.runner, availability: () => [], coordinator: f.coord },
    adminToken: "admin-fixture",
    agentTokens: { codex: "agent-fixture" },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  const call = (path, method = "GET", body, token = "admin-fixture") =>
    fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  for (const [path, method, body] of [
    [`/api/tickets/${ticket.id}/execution-status`, "GET"],
    [`/api/tickets/${ticket.id}/takeover`, "POST", confirm(old)],
    [
      "/api/runs",
      "POST",
      { ticketIds: [ticket.id], requestId: "http-request" },
    ],
    ["/api/tickets/bulk-archive", "POST", { ticketIds: [ticket.id] }],
  ])
    assert.equal((await call(path, method, body, "agent-fixture")).status, 403);
  const status = await call(`/api/tickets/${ticket.id}/execution-status`);
  assert.equal(status.status, 200);
  assert.equal((await status.json()).canTakeOver, true);
  assert.equal(
    (await call(`/api/tickets/${ticket.id}/takeover`, "POST", confirm(old)))
      .status,
    200,
  );
  const batch = await call("/api/runs", "POST", {
    ticketIds: [ticket.id],
    requestId: "http-request",
  });
  assert.equal(batch.status, 202);
  const b = await batch.json();
  assert.equal((await call(`/api/runs/${b.id}`)).status, 200);
  await tick();
  assert.ok(f.store.active(ticket.id));
  const archived = await call("/api/tickets/bulk-archive", "POST", {
    ticketIds: [ticket.id],
  });
  assert.equal(archived.status, 200);
  assert.equal((await archived.json()).results[0].status, "failed");
});

test("missing heartbeat evidence is explicitly stale, never falsely fresh", async (t) => {
  const f = fixture(t),
    old = f.oldClaim(f.ticket());
  const unknown = f.store.saveExecution({ ...old, heartbeatAt: "unknown" });
  assert.equal(unknown.stale, true);
  assert.equal((await f.coord.status(old.ticketId)).canTakeOver, true);
  await f.coord.takeover(old.ticketId, confirm(unknown));
  assert.equal(f.store.active(old.ticketId), null);
});
