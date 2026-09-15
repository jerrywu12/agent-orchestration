import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.mjs";
import { Service } from "../server/service.mjs";
import { createAppServer } from "../server/http.mjs";
import {
  AgentActivityMonitor,
  REASONS,
  ACTIVITY_LIMITS,
} from "../server/agent-activity.mjs";

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
  return { url: `http://127.0.0.1:${server.address().port}`, service, store };
}

test("Guarantee 7: agent-scoped token receives 403 AGENT_SCOPE on GET and POST", async (t) => {
  const agentTokens = { codex: "agent-secret-token" };
  const monitor = new AgentActivityMonitor({ auto: false });
  t.after(() => monitor.close());

  const { url } = await app(t, {
    agentTokens,
    activityMonitor: monitor,
  });

  const getRes = await fetch(`${url}/api/activity`, {
    headers: { Authorization: "Bearer agent-secret-token" },
  });
  assert.equal(getRes.status, 403);
  const getBody = await getRes.json();
  assert.equal(getBody.error?.code, "AGENT_SCOPE");

  const postRes = await fetch(`${url}/api/activity/refresh`, {
    method: "POST",
    headers: { Authorization: "Bearer agent-secret-token" },
  });
  assert.equal(postRes.status, 403);
  const postBody = await postRes.json();
  assert.equal(postBody.error?.code, "AGENT_SCOPE");
});

test("Route availability: 503 when unconstructed and 404 on invalid subpaths", async (t) => {
  const { url } = await app(t, { activityMonitor: null });

  const getRes = await fetch(`${url}/api/activity`);
  assert.equal(getRes.status, 503);
  const getBody = await getRes.json();
  assert.equal(getBody.error?.code, "ACTIVITY_UNAVAILABLE");

  const postRes = await fetch(`${url}/api/activity/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  assert.equal(postRes.status, 503);
  const postBody = await postRes.json();
  assert.equal(postBody.error?.code, "ACTIVITY_UNAVAILABLE");

  const monitor = new AgentActivityMonitor({ auto: false });
  t.after(() => monitor.close());
  const { url: urlWithMonitor } = await app(t, { activityMonitor: monitor });

  const notFoundRes = await fetch(`${urlWithMonitor}/api/activity/extra-path`);
  assert.equal(notFoundRes.status, 404);
});

test("Guarantees 1, 2, 4, 5, 6: payload privacy, fixed wording, read-only, non-blocking, bounded", async (t) => {
  let collectorRunning = false;
  const mockCollector = async ({ signal }) => {
    collectorRunning = true;
    return {
      activeCount: 1,
      state: "active",
      tasks: [
        {
          id: "019f4b72",
          agentId: "codex",
          origin: "Subagent",
          description: "Implement activity endpoint",
          workspace: "agent-desk",
          lifecycle: "active",
        },
      ],
      workers: [
        {
          agentId: "claude",
          agentName: "Claude Code",
          pid: 45012,
          elapsedSeconds: 1874,
        },
      ],
      sleepPrevention: { state: "inactive", holders: [] },
      sources: [
        {
          id: "codex-tasks",
          label: "Codex tasks",
          status: "observed",
          reason: null,
          retained: false,
        },
        {
          id: "processes",
          label: "Processes",
          status: "observed",
          reason: null,
          retained: false,
        },
      ],
      observedAt: new Date().toISOString(),
      stale: false,
      partial: false,
      truncated: false,
      refreshing: false,
      notes: [],
    };
  };

  const monitor = new AgentActivityMonitor({
    auto: false,
    collector: mockCollector,
  });
  t.after(() => monitor.close());
  await monitor.refresh();

  const { url, store } = await app(t, { activityMonitor: monitor });

  // Guarantee 4: Store count before and after
  const beforeCount = store.list("ticket").length;

  // Guarantee 5: Non-blocking GET
  const t0 = Date.now();
  const res = await fetch(`${url}/api/activity`);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 1000, "GET /api/activity must return immediately");
  assert.equal(res.status, 200);

  const payload = await res.json();
  const afterCount = store.list("ticket").length;
  assert.equal(beforeCount, afterCount, "Must not mutate durable store (read-only)");

  // Guarantee 1: Structural privacy sweep over entire payload
  const rawJson = JSON.stringify(payload);
  const forbiddenPatterns = [
    /\/Users\//,
    /\/opt\//,
    /\/Applications\//,
    /--dangerously/,
    /sk-[a-zA-Z0-9]+/,
    /Bearer\s+/,
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, // full UUID
  ];
  for (const pattern of forbiddenPatterns) {
    assert.ok(
      !pattern.test(rawJson),
      `Payload must not contain forbidden pattern ${pattern}`,
    );
  }

  // Guarantee 2: Fixed wording only
  const validReasons = new Set([...Object.values(REASONS), null]);
  for (const src of payload.sources) {
    assert.ok(
      validReasons.has(src.reason),
      `Source reason "${src.reason}" must be from closed set`,
    );
  }
  for (const note of payload.notes) {
    assert.ok(
      typeof note === "string" && note.length <= ACTIVITY_LIMITS.maxNoteLength,
      "Notes must be bounded string",
    );
  }

  // Guarantee 6: Bounded
  assert.ok(payload.tasks.length <= ACTIVITY_LIMITS.maxTasks);
  assert.ok(payload.workers.length <= ACTIVITY_LIMITS.maxWorkers);
  assert.ok(payload.notes.length <= ACTIVITY_LIMITS.maxNotes);
  assert.ok(payload.sleepPrevention.holders.length <= ACTIVITY_LIMITS.maxHolders);
  assert.equal(typeof payload.truncated, "boolean");

  // POST /api/activity/refresh returns 202
  const refreshRes = await fetch(`${url}/api/activity/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  assert.equal(refreshRes.status, 202);
  const refreshPayload = await refreshRes.json();
  assert.ok(refreshPayload.state);
});

test("Guarantee 3: zero is never ambiguous (idle only when all sources observed)", async (t) => {
  const unobsCollector = async () => ({
    activeCount: 0,
    state: "unobservable",
    tasks: [],
    workers: [],
    sleepPrevention: { state: "inactive", holders: [] },
    sources: [
      {
        id: "codex-tasks",
        label: "Codex tasks",
        status: "unobservable",
        reason: REASONS.SOURCE_NOT_FOUND,
        retained: false,
      },
      {
        id: "processes",
        label: "Processes",
        status: "observed",
        reason: null,
        retained: false,
      },
    ],
    observedAt: new Date().toISOString(),
    stale: false,
    partial: true,
    truncated: false,
    refreshing: false,
    notes: [],
  });

  const monitor = new AgentActivityMonitor({
    auto: false,
    collector: unobsCollector,
  });
  t.after(() => monitor.close());
  await monitor.refresh();

  const { url } = await app(t, { activityMonitor: monitor });

  const res = await fetch(`${url}/api/activity`);
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.activeCount, 0);
  assert.equal(
    payload.state,
    "unobservable",
    "Zero count with unobservable source MUST yield state: unobservable, never idle",
  );
  assert.notEqual(payload.state, "idle");
});
