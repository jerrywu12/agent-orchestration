import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";
import { Service } from "../server/service.mjs";
import { MachineMonitor } from "../server/machine-monitor.mjs";
import { createAppServer } from "../server/http.mjs";
async function setup(t) {
  const store = new Store(":memory:"),
    service = new Service(store);
  let scans = 0;
  const machineMonitor = new MachineMonitor(service, {
    auto: false,
    discover: async () => {
      scans++;
      return {
        agents: [],
        libraries: [],
        sources: [],
        issues: [],
        truncated: false,
      };
    },
    probe: async () => ({
      host: null,
      agents: {},
      services: [],
      issues: [],
      processError: null,
    }),
  });
  const server = createAppServer({
    service,
    runner: { availability: () => [] },
    machineMonitor,
    adminToken: "admin-test",
    agentTokens: { codex: "agent-test" },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    machineMonitor.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
  });
  const request = (
    path,
    method = "GET",
    body,
    token = "admin-test",
    extraHeaders = {},
  ) =>
    fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: {
        ...extraHeaders,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { request, machineMonitor, scans: () => scans };
}
test("machine snapshot, refresh and source CRUD require administrator access and never leak into agent state", async (t) => {
  const { request, machineMonitor, scans } = await setup(t);
  for (const [path, method, body] of [
    ["/machine", "GET"],
    ["/machine/refresh", "POST", {}],
    ["/machine/sources", "POST", { path: "/tmp" }],
    ["/machine/sources/anything", "DELETE"],
  ]) {
    assert.equal((await request(path, method, body, null)).status, 401);
    assert.equal((await request(path, method, body, "agent-test")).status, 403);
  }
  assert.equal(scans(), 0);
  let r = await request("/machine");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).scan.inventoryAt, null);
  assert.equal(scans(), 0);
  r = await request("/machine/refresh", "POST", {});
  assert.equal(r.status, 202);
  await machineMonitor.pending;
  assert.equal(scans(), 1);
  const state = await request("/state", "GET", undefined, "agent-test").then(
    (r) => r.json(),
  );
  assert.equal(state.machine, undefined);
  assert.equal(state.customSources, undefined);
  const root = await mkdtemp(join(tmpdir(), "machine-http-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  r = await request("/machine/sources", "POST", {
    path: root,
    label: "Test libraries",
  });
  assert.equal(r.status, 201);
  const source = await r.json();
  await machineMonitor.pending;
  assert.equal(
    (await request("/machine").then((r) => r.json())).customSources[0].id,
    source.id,
  );
  assert.equal(
    (await request("/machine/sources", "POST", { path: root })).status,
    409,
  );
  r = await request(`/machine/sources/${source.id}`, "DELETE");
  assert.equal(r.status, 200);
  await machineMonitor.pending;
  assert.equal(
    (await request("/machine").then((r) => r.json())).customSources.length,
    0,
  );
  assert.equal((await request("/machine/anything")).status, 404);
});
test("cross-origin and invalid folder requests cannot trigger machine scans", async (t) => {
  const { request, scans } = await setup(t);
  assert.equal(
    (await request("/machine/sources", "POST", { path: "../../private" }))
      .status,
    422,
  );
  assert.equal(
    (
      await request("/machine/sources", "POST", {
        path: "https://evil.example",
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await request("/machine/refresh", "POST", {}, "admin-test", {
        origin: "https://foreign.example",
      })
    ).status,
    403,
  );
  assert.equal(scans(), 0);
});
