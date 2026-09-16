import test from "node:test";
import assert from "node:assert/strict";
import {
  SleepCoordinator,
  keepAwakeDemand,
  KEEP_AWAKE_AGENTS,
} from "../server/sleep-coordinator.mjs";

const NOW = Date.parse("2026-09-16T10:00:00.000Z");

function snapshot({ tasks = [], workers = [], observedAt = NOW } = {}) {
  return {
    activeCount: tasks.length + workers.length,
    state: tasks.length + workers.length ? "active" : "idle",
    tasks,
    workers,
    observedAt: observedAt === null ? null : new Date(observedAt).toISOString(),
    stale: false,
    partial: false,
  };
}
const worker = (agentId, pid = 1) => ({ agentId, agentName: agentId, pid, elapsedSeconds: 10 });
const task = (agentId = "codex") => ({ agentId, origin: "Codex", description: "x", workspace: "w", lifecycle: "active" });

/** A coordinator with a fake spawn, so no real caffeinate is ever started. */
function build(overrides = {}) {
  const spawned = [];
  const coordinator = new SleepCoordinator({
    auto: false,
    clock: () => NOW,
    activityMonitor: { snapshot: () => snapshot() },
    spawn: () => {
      const child = {
        pid: 4242 + spawned.length,
        killed: false,
        handlers: {},
        on(event, fn) {
          this.handlers[event] = fn;
        },
        unref() {},
        kill() {
          this.killed = true;
        },
      };
      spawned.push(child);
      return child;
    },
    ...overrides,
  });
  return { coordinator, spawned };
}

test("keep-awake counts only agents that represent work, never helper daemons", () => {
  // Hermes runs as an MCP server spawned by another agent and Ollama is a model
  // runtime; both can be alive with nothing happening. Counting them would pin
  // the machine awake permanently.
  assert.ok(!KEEP_AWAKE_AGENTS.includes("hermes"));
  assert.ok(!KEEP_AWAKE_AGENTS.includes("ollama"));

  const demand = keepAwakeDemand(
    snapshot({
      workers: [
        worker("claude"),
        worker("hermes", 2),
        worker("hermes", 3),
        worker("hermes", 4),
      ],
    }),
  );
  assert.deepEqual(demand, { tasks: 0, workers: 1 });

  // The exact live shape that motivated this: Hermes-only must not hold.
  const hermesOnly = keepAwakeDemand(
    snapshot({ workers: [worker("hermes", 2), worker("hermes", 3)] }),
  );
  assert.deepEqual(hermesOnly, { tasks: 0, workers: 0 });
});

test("holds while work is in flight and releases when it finishes", () => {
  let current = snapshot({ workers: [worker("claude")] });
  const { coordinator, spawned } = build({
    activityMonitor: { snapshot: () => current },
  });

  coordinator.evaluate();
  assert.equal(coordinator.state().holding, true);
  assert.equal(spawned.length, 1);
  assert.match(coordinator.state().reason, /1 worker in flight/);

  // A second evaluation must not start a second assertion.
  coordinator.evaluate();
  assert.equal(spawned.length, 1);

  current = snapshot({ workers: [] });
  coordinator.evaluate();
  assert.equal(coordinator.state().holding, false);
  assert.equal(spawned[0].killed, true);
});

test("codex counts at task granularity", () => {
  const current = snapshot({ tasks: [task("codex")] });
  const { coordinator } = build({ activityMonitor: { snapshot: () => current } });
  coordinator.evaluate();
  assert.equal(coordinator.state().holding, true);
  assert.match(coordinator.state().reason, /1 task in flight/);
});

test("never holds the display awake, so the screen still locks", () => {
  const current = snapshot({ workers: [worker("claude")] });
  const captured = [];
  const { coordinator } = build({
    activityMonitor: { snapshot: () => current },
    spawn: (cmd, args) => {
      captured.push({ cmd, args });
      return { pid: 1, on() {}, unref() {}, kill() {} };
    },
  });
  coordinator.evaluate();
  assert.equal(captured[0].cmd, "/usr/bin/caffeinate");
  assert.deepEqual(captured[0].args, ["-i", "-s"]);
  // -d would prevent display sleep and therefore prevent the screen locking.
  assert.ok(!captured[0].args.includes("-d"));
  assert.equal(coordinator.state().preventsDisplaySleep, false);
});

test("a stale observation never justifies a hold", () => {
  const current = snapshot({
    workers: [worker("claude")],
    observedAt: NOW - 10 * 60 * 1000,
  });
  const { coordinator, spawned } = build({
    activityMonitor: { snapshot: () => current },
  });
  coordinator.evaluate();
  assert.equal(coordinator.state().holding, false);
  assert.equal(spawned.length, 0);
  assert.match(coordinator.state().reason, /too old/);
});

test("an unobserved or unavailable monitor never justifies a hold", () => {
  for (const monitor of [
    { snapshot: () => snapshot({ workers: [worker("claude")], observedAt: null }) },
    { snapshot: () => { throw new Error("boom"); } },
    null,
  ]) {
    const { coordinator, spawned } = build({ activityMonitor: monitor });
    coordinator.evaluate();
    assert.equal(coordinator.state().holding, false);
    assert.equal(spawned.length, 0);
  }
});

test("disabled never holds", () => {
  const current = snapshot({ workers: [worker("claude")] });
  const { coordinator, spawned } = build({
    enabled: false,
    activityMonitor: { snapshot: () => current },
  });
  coordinator.evaluate();
  assert.equal(coordinator.state().holding, false);
  assert.equal(spawned.length, 0);
  assert.match(coordinator.state().reason, /disabled/);
});

test("a hold is bounded even if work never appears to end", () => {
  const current = snapshot({ workers: [worker("claude")] });
  let now = NOW;
  const { coordinator, spawned } = build({
    clock: () => now,
    activityMonitor: {
      snapshot: () => ({ ...current, observedAt: new Date(now).toISOString() }),
    },
  });
  coordinator.evaluate();
  assert.equal(coordinator.state().holding, true);

  now = NOW + 13 * 60 * 60 * 1000;
  coordinator.evaluate();
  assert.equal(coordinator.state().holding, false, "hold must not outlive its ceiling");
  assert.equal(spawned[0].killed, true);
  assert.match(coordinator.state().reason, /maximum continuous hold/);
});

test("close releases the assertion so it never outlives the server", () => {
  const current = snapshot({ workers: [worker("claude")] });
  const { coordinator, spawned } = build({
    activityMonitor: { snapshot: () => current },
  });
  coordinator.evaluate();
  assert.equal(spawned[0].killed, false);
  coordinator.close();
  assert.equal(spawned[0].killed, true);
  assert.equal(coordinator.state().holding, false);
});
