import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn as spawnChild } from "node:child_process";
import {
  AgentStatusMonitor,
  collectCodexCapacity,
  normalizeCodexCapacity,
} from "../server/agent-status.mjs";

const window = (
  usedPercent = 20,
  windowDurationMins = 10080,
  resetsAt = 2000000000,
) => ({
  usedPercent,
  windowDurationMins,
  resetsAt,
});
const response = (overrides = {}) => ({
  ordinaryUsageAllowed: true,
  rateLimits: { limitId: "codex", primary: window() },
  ...overrides,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function fakeSpawn(onMessage) {
  const calls = [];
  const children = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.killed = false;
    child.kill = () => {
      if (!child.killed) {
        child.killed = true;
        queueMicrotask(() => child.emit("close", 0, "SIGTERM"));
      }
      return true;
    };
    child.stdin.on("data", (chunk) => {
      for (const line of chunk.toString().trim().split("\n")) {
        const message = JSON.parse(line);
        queueMicrotask(() => onMessage(message, child));
      }
    });
    children.push(child);
    return child;
  };
  return { spawn, calls, children };
}
const reply = (child, value) =>
  child.stdout.write(JSON.stringify(value) + "\n");
const fixtureCollector = (raw) => async () => normalizeCodexCapacity(raw);

test("Codex keeps bucket scope and reported durations; explicit account permission wins", () => {
  const value = normalizeCodexCapacity(
    response({
      accountId: "SECRET account",
      rateLimitsByLimitId: {
        codex: {
          limitId: "codex",
          primary: window(20, 10080),
          secondary: window(30, 15),
          individualLimit: {
            remainingPercent: 70,
            resetsAt: 2000000000,
            limit: "PRIVATE",
            used: "PRIVATE",
          },
        },
        codex_spark: {
          limitId: "codex_spark",
          limitName: "GPT-5.3-Codex-Spark",
          primary: window(100, 300),
          rateLimitReachedType: "rate_limit_reached",
          spendControlReached: true,
        },
      },
    }),
  );
  assert.equal(value.status, "available");
  assert.equal(value.ordinaryUsageAllowed, true);
  assert.equal(value.windows.length, 4);
  const weekly = value.windows.find((w) => w.id === "codex:primary");
  assert.equal(weekly.windowMinutes, 10080);
  assert.equal(weekly.remainingPercent, 80);
  assert.match(weekly.label, /7.day|weekly/i);
  assert.equal(weekly.resetsAt, "2033-05-18T03:33:20.000Z");
  assert.match(
    value.windows.find((w) => w.id === "codex:secondary").label,
    /15/,
  );
  const spark = value.windows.find((w) => w.id === "codex_spark:primary");
  assert.equal(spark.rateLimitReachedType, "rate_limit_reached");
  assert.equal(spark.spendControlReached, true);
  const individual = value.windows.find((w) => w.id === "codex:individual");
  assert.equal(individual.usedPercent, 30);
  assert.equal(individual.remainingPercent, 70);
  assert.equal(individual.windowMinutes, null);
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE|SECRET/);
});

test("null and invalid usage never become zero or a guessed reset", () => {
  const value = normalizeCodexCapacity(
    response({
      ordinaryUsageAllowed: null,
      rateLimits: {
        limitId: "codex",
        primary: {
          usedPercent: null,
          resetsAt: null,
          windowDurationMins: null,
        },
        secondary: {
          usedPercent: "0",
          resetsAt: "2000000000",
          windowDurationMins: -1,
        },
      },
    }),
  );
  assert.equal(value.status, "unknown");
  assert.equal(value.ordinaryUsageAllowed, null);
  for (const w of value.windows) {
    assert.equal(w.usedPercent, null);
    assert.equal(w.remainingPercent, null);
    assert.equal(w.resetsAt, null);
    assert.equal(w.windowMinutes, null);
  }
  assert.equal(
    normalizeCodexCapacity(response({ ordinaryUsageAllowed: null })).status,
    "unknown",
  );
});

test("explicit main bucket limit signals are retained independently from percentages", () => {
  for (const flag of [
    { rateLimitReachedType: "workspace_member_usage_limit_reached" },
    { spendControlReached: true },
  ]) {
    const value = normalizeCodexCapacity(
      response({
        ordinaryUsageAllowed: null,
        rateLimits: { limitId: "codex", primary: window(1), ...flag },
      }),
    );
    assert.equal(value.status, "limited");
  }
  assert.equal(
    normalizeCodexCapacity(response({ ordinaryUsageAllowed: false })).status,
    "limited",
  );
  const unrelated = normalizeCodexCapacity(
    response({
      ordinaryUsageAllowed: null,
      rateLimitsByLimitId: {
        spark: {
          limitId: "spark",
          primary: window(100),
          spendControlReached: true,
        },
      },
    }),
  );
  assert.equal(unrelated.status, "unknown");
});

test("Codex rejects malformed and oversized quota shapes without exposing raw data", () => {
  for (const raw of [
    null,
    [],
    {},
    { rateLimits: "SECRET" },
    { rateLimitsByLimitId: [] },
    {
      rateLimitsByLimitId: Object.fromEntries(
        Array.from({ length: 101 }, (_, n) => [`bucket${n}`, {}]),
      ),
    },
  ]) {
    assert.throws(
      () => normalizeCodexCapacity(raw),
      (e) => {
        assert.doesNotMatch(e.message, /SECRET/);
        return true;
      },
    );
  }
  const value = normalizeCodexCapacity(
    response({
      rateLimits: {
        limitId: "codex",
        limitName: "Bearer SECRET\n<script>",
        primary: window(),
      },
    }),
  );
  assert.doesNotMatch(JSON.stringify(value), /SECRET|script|Bearer/);
});

test("monitor is lazy, coalesces refreshes, isolates providers, and returns detached snapshots", async (t) => {
  const gate = deferred();
  let calls = 0;
  const monitor = new AgentStatusMonitor({
    agents: ["codex", "claude"],
    clock: () => 1000,
    collectors: {
      codex: async ({ signal }) => {
        assert.ok(signal instanceof AbortSignal);
        calls++;
        await gate.promise;
        return normalizeCodexCapacity(response());
      },
    },
  });
  t.after(() => monitor.close());
  assert.equal(calls, 0);
  assert.equal(monitor.snapshot().agents[0].observedAt, null);
  const a = monitor.refresh();
  const b = monitor.refresh();
  assert.equal(a, b);
  assert.equal(monitor.snapshot().refreshing, true);
  gate.resolve();
  await a;
  assert.equal(calls, 1);
  assert.equal(monitor.snapshot().refreshing, false);
  assert.equal(
    monitor.snapshot().agents[0].observedAt,
    "1970-01-01T00:00:01.000Z",
  );
  assert.equal(monitor.snapshot().agents[1].status, "unavailable");
  const copy = monitor.snapshot();
  copy.agents[0].windows[0].usedPercent = 99;
  assert.equal(monitor.snapshot().agents[0].windows[0].usedPercent, 20);
});

test("TTL and elapsed resets make observations stale without inferring recovery", async (t) => {
  let now = 100000;
  const monitor = new AgentStatusMonitor({
    agents: ["codex"],
    clock: () => now,
    ttlMs: 10000,
    collectors: {
      codex: fixtureCollector(
        response({
          ordinaryUsageAllowed: false,
          rateLimits: { limitId: "codex", primary: window(100, 5, 102) },
        }),
      ),
    },
  });
  t.after(() => monitor.close());
  await monitor.refresh();
  assert.equal(monitor.snapshot().agents[0].stale, false);
  now = 102001;
  assert.equal(monitor.snapshot().agents[0].stale, true);
  assert.equal(monitor.snapshot().agents[0].status, "limited");
  assert.equal(monitor.snapshot().agents[0].ordinaryUsageAllowed, false);
  now = 120000;
  assert.equal(monitor.snapshot().agents[0].stale, true);
});

test("failed refresh retains prior limits and timestamp, and redacts provider errors", async (t) => {
  let broken = false;
  let now = 1000;
  const monitor = new AgentStatusMonitor({
    agents: ["codex"],
    clock: () => now,
    collectors: {
      codex: async () => {
        if (broken) throw Error("Bearer SECRET private transcript");
        return normalizeCodexCapacity(response());
      },
    },
  });
  t.after(() => monitor.close());
  await monitor.refresh();
  broken = true;
  now = 2000;
  await monitor.refresh({ force: true });
  const value = monitor.snapshot().agents[0];
  assert.equal(value.status, "unknown");
  assert.equal(value.stale, true);
  assert.equal(value.observedAt, "1970-01-01T00:00:01.000Z");
  assert.equal(value.windows[0].usedPercent, 20);
  assert.doesNotMatch(JSON.stringify(value), /SECRET|transcript|Bearer/);
});

test("failed and elapsed-reset reads have retry cooldown; explicit refresh bypasses it", async (t) => {
  let now = 100000;
  let calls = 0;
  let fail = true;
  const monitor = new AgentStatusMonitor({
    agents: ["codex", "ollama"],
    clock: () => now,
    ttlMs: 10000,
    collectors: {
      codex: async () => {
        calls++;
        if (fail) throw Error("SECRET");
        return normalizeCodexCapacity(
          response({
            ordinaryUsageAllowed: false,
            rateLimits: { limitId: "codex", primary: window(100, 5, 101) },
          }),
        );
      },
    },
  });
  t.after(() => monitor.close());
  await monitor.refresh();
  assert.equal(calls, 1);
  assert.equal(
    monitor.snapshot().agents[0].observedAt,
    "1970-01-01T00:01:40.000Z",
  );
  now = 102000;
  await monitor.refresh();
  assert.equal(calls, 1);
  fail = false;
  await monitor.refresh({ force: true });
  assert.equal(calls, 2);
  assert.equal(monitor.snapshot().agents[0].stale, true);
  now = 104000;
  await monitor.refresh();
  assert.equal(calls, 2);
  now = 113000;
  await monitor.refresh();
  assert.equal(calls, 3);
  assert.equal(monitor.snapshot().agents[0].status, "limited");
});

test("an explicit empty collector map disables native Codex discovery and polling", async (t) => {
  const monitor = new AgentStatusMonitor({ agents: ["codex"], collectors: {} });
  t.after(() => monitor.close());
  await monitor.refresh();
  const result = monitor.snapshot().agents[0];
  assert.equal(result.source, "unsupported");
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.windows, []);
});

test("close aborts collectors, settles pending refresh, and rejects late observations", async () => {
  const gate = deferred();
  let signal;
  const monitor = new AgentStatusMonitor({
    agents: ["codex"],
    collectors: {
      codex: async (ctx) => {
        signal = ctx.signal;
        await gate.promise;
        return normalizeCodexCapacity(response());
      },
    },
  });
  const pending = monitor.refresh();
  await Promise.resolve();
  monitor.close();
  assert.equal(signal.aborted, true);
  await pending;
  gate.resolve();
  await Promise.resolve();
  assert.equal(monitor.snapshot().agents[0].observedAt, null);
  await monitor.refresh();
});

test("unsupported providers return truthful separate reasons without invoking any CLI", async (t) => {
  const monitor = new AgentStatusMonitor({
    agents: [
      "claude",
      "gemini",
      "cursor",
      "antigravity",
      "hermes",
      "ollama",
      "arkcli",
      "constructor",
    ],
  });
  t.after(() => monitor.close());
  await monitor.refresh();
  for (const row of monitor.snapshot().agents) {
    assert.equal(row.status, "unavailable");
    assert.deepEqual(row.windows, []);
    assert.match(row.message, /limit|quota/i);
  }
  assert.match(
    monitor.snapshot().agents.find((r) => r.agentId === "arkcli").message,
    /migration/i,
  );
  assert.match(
    monitor.snapshot().agents.find((r) => r.agentId === "ollama").message,
    /cloud/i,
  );
});

test("passive stdio protocol sends only initialize, initialized, and rate-limit read", async () => {
  const messages = [];
  const fake = fakeSpawn((message, child) => {
    messages.push(message);
    if (message.method === "initialize")
      reply(child, { id: 1, result: { userAgent: "PRIVATE" } });
    if (message.method === "account/rateLimits/read") {
      reply(child, {
        method: "unrelated/notification",
        params: { private: "SECRET" },
      });
      reply(child, { id: 2, result: response() });
    }
  });
  const value = await collectCodexCapacity({
    command: "/fixture/codex",
    spawn: fake.spawn,
  });
  assert.deepEqual(
    messages.map((m) => m.method),
    ["initialize", "initialized", "account/rateLimits/read"],
  );
  assert.deepEqual(fake.calls[0].args, ["app-server", "--stdio"]);
  assert.equal(fake.calls[0].options.shell, false);
  assert.deepEqual(fake.calls[0].options.stdio, ["pipe", "pipe", "pipe"]);
  assert.equal(value.status, "available");
  assert.equal(fake.children[0].killed, true);
  assert.doesNotMatch(JSON.stringify(value), /SECRET|PRIVATE/);
});

test("passive process errors have safe auth status and never return raw provider error text", async () => {
  const fake = fakeSpawn((message, child) =>
    reply(child, {
      id: message.id,
      error: { code: -32000, message: "authentication required SECRET" },
    }),
  );
  await assert.rejects(
    collectCodexCapacity({ command: "/fixture/codex", spawn: fake.spawn }),
    (e) => {
      assert.equal(e.status, "auth_required");
      assert.doesNotMatch(e.message, /SECRET/);
      return true;
    },
  );
  assert.equal(fake.children[0].killed, true);
});

test("deadlines, output bounds, bad JSON and server requests terminate the owned process", async () => {
  for (const mode of [
    "timeout",
    "stdout",
    "stderr",
    "json",
    "server-request",
  ]) {
    const fake = fakeSpawn((_message, child) => {
      if (mode === "stdout") child.stdout.write("x".repeat(300000));
      if (mode === "stderr") child.stderr.write("SECRET".repeat(50000));
      if (mode === "json") child.stdout.write("not json SECRET\n");
      if (mode === "server-request")
        reply(child, {
          id: 70,
          method: "account/chatgptAuthTokens/refresh",
          params: {},
        });
    });
    await assert.rejects(
      collectCodexCapacity({
        command: "/fixture/codex",
        spawn: fake.spawn,
        timeoutMs: 20,
      }),
      (e) => {
        assert.doesNotMatch(e.message, /SECRET/);
        return true;
      },
    );
    assert.equal(fake.children[0].killed, true, mode);
  }
});

test("abort terminates passive child and cannot accept later output", async () => {
  const controller = new AbortController();
  const fake = fakeSpawn(() => controller.abort());
  await assert.rejects(
    collectCodexCapacity({
      command: "/fixture/codex",
      spawn: fake.spawn,
      signal: controller.signal,
    }),
  );
  assert.equal(fake.children[0].killed, true);
});

test("real fixture child exits after the bounded read; no host Codex or model is invoked", async () => {
  let child;
  const program = `
    const readline = require('node:readline');
    const rl = readline.createInterface({input: process.stdin});
    const methods = [];
    rl.on('line', line => {
      const m = JSON.parse(line); methods.push(m.method);
      if(m.method === 'initialize') console.log(JSON.stringify({id:1,result:{}}));
      else if(m.method === 'account/rateLimits/read') {
        if(methods.join(',') !== 'initialize,initialized,account/rateLimits/read') process.exit(9);
        console.log(JSON.stringify({id:2,result:${JSON.stringify(response())}}));
      } else if(m.method !== 'initialized') process.exit(10);
    });
  `;
  const result = await collectCodexCapacity({
    command: "/fixture/codex",
    spawn: (_command, args, options) => {
      assert.deepEqual(args, ["app-server", "--stdio"]);
      child = spawnChild(process.execPath, ["-e", program], options);
      return child;
    },
  });
  assert.equal(result.status, "available");
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});
