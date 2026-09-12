import test from "node:test";
import http from "node:http";
import assert from "node:assert/strict";
import { Store } from "../server/store.mjs";
import { Service } from "../server/service.mjs";
import { createAppServer } from "../server/http.mjs";
async function app(t, options = {}) {
  const store = new Store(":memory:");
  const service = new Service(store);
  const server = createAppServer({
    service,
    runner: {
      availability: () => [],
      start: () => {
        throw Error("must not run");
      },
      stop: () => {},
    },
    ...options,
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
  });
  return { url: `http://127.0.0.1:${server.address().port}`, service };
}
test("API persists edits and rejects foreign origins and DNS rebinding hosts", async (t) => {
  const { url } = await app(t);
  let r = await fetch(url + "/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "API test" }),
  });
  assert.equal(r.status, 201);
  const p = await r.json();
  r = await fetch(url + "/api/state");
  assert.equal((await r.json()).projects[0].id, p.id);
  r = await fetch(url + "/api/projects", {
    method: "POST",
    headers: {
      origin: "https://evil.example",
      "content-type": "application/json",
    },
    body: '{"name":"evil"}',
  });
  assert.equal(r.status, 403);
  const status = await new Promise((resolve, reject) => {
    http
      .get(
        url + "/api/state",
        { headers: { host: "evil.example" } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      )
      .on("error", reject);
  });
  assert.equal(status, 403);
});
test("admin auth required with remote mode, agent credentials cannot mutate arbitrary tasks", async (t) => {
  const { url, service } = await app(t, {
    adminToken: "test-admin-secret",
    agentTokens: { codex: "codex-secret" },
  });
  assert.equal((await fetch(url + "/api/state")).status, 401);
  assert.equal(
    (
      await fetch(url + "/api/state", {
        headers: { authorization: "Bearer invalid" },
      })
    ).status,
    401,
  );
  let r = await fetch(url + "/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"token":"test-admin-secret"}',
  });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("set-cookie"), /HttpOnly/);
  assert.equal(
    (
      await fetch(url + "/api/projects", {
        method: "POST",
        headers: {
          authorization: "Bearer codex-secret",
          "content-type": "application/json",
        },
        body: '{"name":"bad"}',
      })
    ).status,
    403,
  );
  const p = service.createProject({ name: "Owned" });
  const stage = service
    .state()
    .stages.find((s) => s.projectId === p.id && s.role === "planning");
  const a = service.createTicket({
    projectId: p.id,
    title: "Owned ticket",
    stageId: stage.id,
    ownerId: "claude",
  });
  r = await fetch(url + `/api/tickets/${a.id}/claim`, {
    method: "POST",
    headers: {
      authorization: "Bearer codex-secret",
      "content-type": "application/json",
    },
    body: '{"agentId":"claude","sessionId":"bad"}',
  });
  assert.equal(r.status, 403);
});
test("bad payloads have consistent errors and health exposes verified app identity", async (t) => {
  const { url } = await app(t);
  let r = await fetch(url + "/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{oops",
  });
  assert.equal(r.status, 400);
  assert.equal(typeof (await r.json()).error.message, "string");
  r = await fetch(url + "/api/health");
  const body = await r.json();
  assert.equal(body.status, "ok");
  assert.ok(body.root);
  assert.equal(body.storage, "ready");
});

test("independent API claims remain recoverable after their client disappears", async (t) => {
  const { url, service } = await app(t);
  const project = service.createProject({ name: "Recovery" });
  const stage = service
    .state()
    .stages.find((s) => s.projectId === project.id && s.role === "planning");
  const ticket = service.createTicket({
    projectId: project.id,
    title: "External runner",
    ownerId: "codex",
    stageId: stage.id,
  });
  const response = await fetch(url + `/api/tickets/${ticket.id}/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agentId: "codex",
      sessionId: "independent-client",
      external: false,
    }),
  });
  const run = await response.json();
  assert.equal(run.external, true);
  const recovered = await fetch(url + `/api/executions/${run.id}/reconcile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: run.sessionId,
      stopped: true,
      summary: "Verified native client stopped and checkpoint retained.",
    }),
  });
  assert.equal(recovered.status, 200);
  assert.equal(service.store.active(ticket.id), null);
});
