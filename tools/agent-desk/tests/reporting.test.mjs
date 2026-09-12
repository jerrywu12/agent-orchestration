import test from "node:test";
import assert from "node:assert/strict";
import { eventReporter, agentEnvironment } from "../bin/reporting.mjs";
test("transient response loss retries the same event identity and sequence", async () => {
  const calls = [];
  let first = true;
  const emit = eventReporter({
    run: { id: "run", lastSeq: 4 },
    agentId: "codex",
    sessionId: "session",
    config: {},
    delay: async () => {},
    send: async (_m, _p, body) => {
      calls.push(body);
      if (first) {
        first = false;
        throw Error("response lost");
      }
      return {};
    },
  });
  await emit("heartbeat", "alive");
  await emit("complete", "finished");
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].seq, 5);
  assert.equal(calls[2].seq, 6);
  assert.notEqual(calls[0].eventId, calls[2].eventId);
});
test("an exhausted heartbeat does not poison later terminal reporting", async () => {
  let online = false;
  const calls = [];
  const emit = eventReporter({
    run: { id: "run", lastSeq: 0 },
    agentId: "codex",
    sessionId: "session",
    config: {},
    delay: async () => {},
    send: async (_m, _p, body) => {
      calls.push(body);
      if (!online) throw Error("offline");
      return {};
    },
  });
  await assert.rejects(emit("heartbeat", "alive"), /offline/);
  online = true;
  await emit("complete", "finished");
  assert.equal(calls.at(-1).type, "complete");
  assert.equal(calls.at(-1).seq, 2);
});
test("agent environment retains provider configuration but strips board administrator and inherited execution credentials", () => {
  assert.deepEqual(
    agentEnvironment(
      {
        PATH: "/bin",
        PROVIDER_KEY: "provider-test",
        AGENT_DESK_ADMIN_TOKEN: "administrator",
        AGENT_DESK_TOKEN: "old",
        AGENT_DESK_SESSION_ID: "old",
        AGENT_DESK_DATA_DIR: "/server/private",
      },
      { AGENT_DESK_TOKEN: "scoped", AGENT_DESK_SESSION_ID: "new" },
    ),
    {
      PATH: "/bin",
      PROVIDER_KEY: "provider-test",
      AGENT_DESK_TOKEN: "scoped",
      AGENT_DESK_SESSION_ID: "new",
    },
  );
});

test("wrapper terminal event recovers sequence advanced by its native agent", async () => {
  let lastSeq = 1;
  const events = [];
  const run = { id: "shared", lastSeq: 0, sessionId: "session" };
  const emit = eventReporter({
    run,
    agentId: "codex",
    sessionId: "session",
    config: {},
    delay: async () => {},
    send: async (method, _path, body) => {
      if (method === "GET")
        return {
          tickets: [{ execution: { ...run, lastSeq, releasedAt: null } }],
        };
      if (body.seq <= lastSeq)
        throw Object.assign(
          Error("Sequence already advanced by native client"),
          { status: 409, code: "STALE_EVENT" },
        );
      lastSeq = body.seq;
      events.push(body);
      return {};
    },
  });
  await emit("complete", "wrapped child finished");
  assert.equal(events.length, 1);
  assert.equal(events[0].seq, 2);
  assert.equal(events[0].type, "complete");
});

test("native terminal report is respected when its wrapper exits afterward", async () => {
  const ended = {
    id: "shared",
    sessionId: "session",
    lastSeq: 2,
    releasedAt: "2026-09-13T00:00:00Z",
    state: "awaiting_review",
  };
  const emit = eventReporter({
    run: { id: "shared", lastSeq: 0 },
    agentId: "codex",
    sessionId: "session",
    config: {},
    send: async (method) => {
      if (method === "GET") return { tickets: [{ execution: ended }] };
      throw Object.assign(Error("Execution finished"), {
        status: 409,
        code: "EXECUTION_FINISHED",
      });
    },
  });
  assert.deepEqual(await emit("complete", "wrapper exited"), ended);
});
