import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";
import { Service } from "../server/service.mjs";
import { MachineMonitor } from "../server/machine-monitor.mjs";
const agent = {
  id: "codex-cli",
  name: "Codex CLI",
  kind: "agent",
  installed: true,
  version: "1.2.3",
  path: "/fixture/codex",
  deskAgentId: "codex",
};
const inventory = () => ({
  agents: [agent],
  libraries: [],
  sources: [],
  issues: [],
  truncated: false,
});
const runtime = () => ({
  host: {
    name: "fixture",
    platform: "darwin",
    arch: "arm64",
    memoryTotalBytes: 1000,
    memoryFreeBytes: 400,
    loadAverage: [1, 2, 3],
    uptimeSeconds: 100,
  },
  agents: {
    "codex-cli": {
      status: "running",
      processes: [{ pid: 123, cpuPercent: 2, memoryBytes: 100 }],
      cpuPercent: 2,
      memoryBytes: 100,
    },
  },
  services: [],
  issues: [],
  processError: null,
});
function setup(t, options = {}) {
  const store = new Store(":memory:");
  const service = new Service(store);
  const monitor = new MachineMonitor(service, {
    auto: false,
    discover: async () => inventory(),
    probe: async () => runtime(),
    ...options,
  });
  t.after(() => {
    monitor.close();
    store.close();
  });
  return { monitor, service, store };
}
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
test("cached snapshots are immediate, refresh coalesces, observations do not mutate claims", async (t) => {
  const gate = deferred();
  let calls = 0;
  const { monitor, service } = setup(t, {
    discover: async () => {
      calls++;
      await gate.promise;
      return inventory();
    },
  });
  const before = JSON.stringify(service.state().tickets);
  const a = monitor.refresh(),
    b = monitor.refresh();
  assert.equal(monitor.snapshot().scan.state, "scanning");
  assert.equal(calls, 1);
  assert.equal(monitor.snapshot().host, null);
  gate.resolve();
  await Promise.all([a, b]);
  assert.equal(calls, 1);
  assert.equal(monitor.snapshot().agents[0].status, "running");
  assert.equal(monitor.snapshot().agents[0].processes[0].pid, 123);
  assert.equal(JSON.stringify(service.state().tickets), before);
  assert.ok(monitor.snapshot().scan.inventoryAt);
  assert.equal(monitor.snapshot().scan.state, "idle");
});
test("failed inventory and process probes retain prior values with honest stale errors and old times", async (t) => {
  let fail = false,
    time = 10000;
  const { monitor } = setup(t, {
    clock: () => time,
    discover: async () => {
      if (fail) throw Error("SECRET file content");
      return inventory();
    },
    probe: async () =>
      fail
        ? { ...runtime(), agents: {}, processError: "Process access denied." }
        : runtime(),
  });
  await monitor.refresh();
  const before = monitor.snapshot();
  fail = true;
  time += 20000;
  await monitor.refresh();
  const after = monitor.snapshot();
  assert.equal(after.agents[0].version, "1.2.3");
  assert.equal(after.agents[0].status, "unknown");
  assert.equal(after.agents[0].processes[0].pid, 123);
  assert.equal(after.scan.inventoryAt, before.scan.inventoryAt);
  assert.ok(after.scan.error);
  assert.ok(after.scan.runtimeError);
  assert.doesNotMatch(JSON.stringify(after), /SECRET/);
});
test("runtime sampling avoids rescanning libraries until inventory interval", async (t) => {
  let time = 100000,
    calls = 0,
    probes = 0;
  const { monitor } = setup(t, {
    clock: () => time,
    inventoryIntervalMs: 300000,
    discover: async () => {
      calls++;
      return inventory();
    },
    probe: async () => {
      probes++;
      return runtime();
    },
  });
  await monitor.refresh();
  time += 15000;
  await monitor.refresh({ inventory: false });
  assert.equal(calls, 1);
  assert.equal(probes, 2);
  time += 300000;
  await monitor.refresh({ inventory: false });
  assert.equal(calls, 2);
});
test("sources validate, deduplicate concurrent writes, persist across restart and remove only config", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "machine-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { monitor, service, store } = setup(t);
  await assert.rejects(monitor.addSource({ path: "relative" }), {
    status: 422,
  });
  await assert.rejects(monitor.addSource({ path: join(root, "missing") }), {
    status: 422,
  });
  await assert.rejects(
    monitor.addSource({ path: root, label: "x".repeat(81) }),
    { status: 422 },
  );
  const results = await Promise.allSettled([
    monitor.addSource({ path: root, label: "Libraries" }),
    monitor.addSource({ path: root }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.status, 409);
  await monitor.refresh();
  const source = monitor.snapshot().customSources[0];
  monitor.close();
  const reopened = new MachineMonitor(service, {
    auto: false,
    discover: async () => inventory(),
    probe: async () => runtime(),
  });
  t.after(() => reopened.close());
  assert.equal(reopened.snapshot().customSources[0].path, await realpath(root));
  reopened.removeSource(source.id);
  await reopened.refresh();
  assert.equal(store.list("machine-source").length, 0);
  await assert.rejects(reopened.addSource({ path: root, label: "" }), {
    status: 422,
  });
  const added = await reopened.addSource({ path: root });
  assert.ok(added.id);
  await reopened.refresh();
  assert.throws(() => reopened.removeSource("missing"), { status: 404 });
});
test("source changes during scan discard old generation and rescan latest configuration", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "machine-source-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const gate = deferred(),
    started = deferred();
  let calls = 0;
  const seen = [];
  const { monitor } = setup(t, {
    discover: async ({ customSources }) => {
      calls++;
      seen.push(customSources.map((s) => s.id));
      if (calls === 1) {
        started.resolve();
        await gate.promise;
      }
      return {
        ...inventory(),
        sources: customSources.map((s) => ({
          ...s,
          kind: "custom",
          status: "scanned",
          packageCount: 0,
        })),
      };
    },
  });
  const scan = monitor.refresh();
  await started.promise;
  const source = await monitor.addSource({ path: root });
  monitor.removeSource(source.id);
  gate.resolve();
  await scan;
  assert.equal(calls, 2);
  assert.deepEqual(seen[1], []);
  assert.deepEqual(monitor.snapshot().sources, []);
  assert.deepEqual(monitor.snapshot().customSources, []);
});
test("deadline and shutdown do not leave hung collectors or erase prior data", async (t) => {
  let hang = false;
  const { monitor } = setup(t, {
    scanTimeoutMs: 30,
    discover: async () => (hang ? new Promise(() => {}) : inventory()),
  });
  await monitor.refresh();
  hang = true;
  await monitor.refresh();
  assert.ok(monitor.snapshot().scan.error);
  assert.equal(monitor.snapshot().agents.length, 1);
  const pending = monitor.refresh();
  monitor.close();
  await pending;
  assert.equal(monitor.snapshot().scan.state, "error");
});
