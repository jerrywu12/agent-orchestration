import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.mjs";
import { Service } from "../server/service.mjs";
import { createAppServer } from "../server/http.mjs";

async function fixture(t) {
  const store = new Store(":memory:");
  const service = new Service(store);
  const project = service.createProject({ name: "Launch repair" });
  const ticket = service.createTicket({
    projectId: project.id,
    title: "Delivered",
    ownerId: "codex",
    stageId: store.list("stage", project.id).find((s) => s.role === "done").id,
  });
  const malformed = store.put("launch-intent", { ...ticket });
  const execution = store.saveExecution({
    id: "saved-run",
    ticketId: ticket.id,
    agentId: "codex",
    sessionId: "saved-session",
    state: "awaiting_review",
    releasedAt: "2026-09-21T00:00:00Z",
    lastSeq: 3,
  });
  const server = createAppServer({
    service,
    runner: {
      availability: () => [],
      start: () => assert.fail("must not launch"),
    },
    adminToken: "fixture-admin",
    agentTokens: { codex: "fixture-agent" },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
  });
  const input = {
    version: ticket.version,
    launchIntentVersion: malformed.version,
    reason:
      "Verified production merge and rendered control; historical ticket snapshot is malformed.",
  };
  const request = (data = input, token = "fixture-admin") =>
    fetch(
      `http://127.0.0.1:${server.address().port}/api/tickets/${ticket.id}/repair-launch-intent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(data),
      },
    );
  return { store, service, ticket, malformed, execution, input, request };
}

test("repair removes only malformed intent, archives evidence, preserves ticket/execution and retries safely", async (t) => {
  const f = await fixture(t);
  const before = f.service.getTicket(f.ticket.id);
  const r = await f.request();
  assert.equal(r.status, 200);
  const result = await r.json();
  assert.equal(result.outcome, "repaired");
  assert.equal(result.ticket.launchIntent, null);
  assert.deepEqual(result.ticket, { ...before, launchIntent: null });
  const archive = f.store.list("launch-intent-repair");
  assert.equal(archive.length, 1);
  assert.deepEqual(archive[0].original, f.malformed);
  assert.equal(archive[0].reason, f.input.reason);
  assert.equal(archive[0].ticketId, f.ticket.id);
  assert.equal(
    f.store.activities().filter((a) => a.kind === "launch_intent_repaired")
      .length,
    1,
  );
  assert.equal((await (await f.request()).json()).outcome, "unchanged");
  assert.equal(f.store.list("launch-intent-repair").length, 1);
});

test("repair enforces administrator, versions, reason, Done stage and no active execution", async (t) => {
  const f = await fixture(t);
  for (const [input, token, status] of [
    [f.input, null, 401],
    [f.input, "fixture-agent", 403],
    [{ ...f.input, version: 999 }, "fixture-admin", 409],
    [{ ...f.input, launchIntentVersion: 999 }, "fixture-admin", 409],
    [{ ...f.input, reason: "" }, "fixture-admin", 422],
    [{ ...f.input, launchIntentVersion: undefined }, "fixture-admin", 422],
  ])
    assert.equal((await f.request(input, token)).status, status);
  const before = f.store.get("ticket", f.ticket.id);
  f.store.put("ticket", {
    ...before,
    stageId: f.store
      .list("stage", before.projectId)
      .find((s) => s.role === "review").id,
  });
  assert.equal(
    (
      await f.request({
        ...f.input,
        version: f.store.get("ticket", before.id).version,
      })
    ).status,
    409,
  );
  f.store.put("ticket", before);
  f.store.saveExecution({
    ...f.store.execution("saved-run"),
    releasedAt: null,
    state: "external",
  });
  assert.equal(
    (
      await f.request({
        ...f.input,
        version: f.store.get("ticket", before.id).version,
      })
    ).status,
    409,
  );
  assert.deepEqual(f.store.get("launch-intent", before.id), f.malformed);
  assert.equal(f.store.list("launch-intent-repair").length, 0);
});

test("valid launch statuses are never erased, including a concurrent replacement", async (t) => {
  const f = await fixture(t);
  for (const status of ["queued", "started", "failed"]) {
    const intent = f.store.put("launch-intent", {
      id: f.ticket.id,
      ticketId: f.ticket.id,
      status,
    });
    assert.equal((await f.request()).status, 409);
    assert.equal(
      (await f.request({ ...f.input, launchIntentVersion: intent.version }))
        .status,
      409,
    );
    assert.deepEqual(f.store.get("launch-intent", f.ticket.id), intent);
  }
  assert.equal(f.store.list("launch-intent-repair").length, 0);
});

test("audit failure rolls back archive and removal together", async (t) => {
  const f = await fixture(t);
  const activity = f.store.activity.bind(f.store);
  f.store.activity = (...args) => {
    if (args[1] === "launch_intent_repaired")
      throw Error("synthetic audit failure");
    return activity(...args);
  };
  assert.equal((await f.request()).status, 500);
  assert.deepEqual(f.store.get("launch-intent", f.ticket.id), f.malformed);
  assert.equal(f.store.list("launch-intent-repair").length, 0);
});

test("concurrent duplicate repairs archive once", async (t) => {
  const f = await fixture(t);
  const results = await Promise.all([f.request(), f.request()]);
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 200],
  );
  const bodies = await Promise.all(results.map((r) => r.json()));
  assert.deepEqual(bodies.map((r) => r.outcome).sort(), [
    "repaired",
    "unchanged",
  ]);
  assert.equal(f.store.list("launch-intent-repair").length, 1);
});
