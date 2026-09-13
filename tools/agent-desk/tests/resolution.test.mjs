import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Store } from "../server/store.mjs";
import { Service } from "../server/service.mjs";
import { createAppServer } from "../server/http.mjs";

async function fixture(t) {
  const store = new Store(":memory:"),
    service = new Service(store);
  const project = service.createProject({ name: "Resolution" });
  const stages = Object.fromEntries(
    store.list("stage", project.id).map((s) => [s.role, s.id]),
  );
  const make = (extra = {}) =>
    service.createTicket({
      projectId: project.id,
      title: "Assigned work",
      ownerId: "codex",
      stageId: stages.ready,
      ...extra,
    });
  const foreign = make({
    ownerId: "claude",
    title: "Foreign dependency",
    description: "PRIVATE FOREIGN DESCRIPTION",
  });
  const foreignRun = service.claim(foreign.id, {
    agentId: "claude",
    sessionId: "foreign-session",
  });
  const ticket = make({
    stageId: stages.backlog,
    blockedReason: "dependency",
    dependsOn: [foreign.id],
  });
  const run = service.claim(
    ticket.id,
    { agentId: "codex", sessionId: "resolver" },
    { resolveBlockers: true },
  );
  const auth = {
    agentId: "codex",
    executionId: run.id,
    sessionId: run.sessionId,
  };
  const server = createAppServer({
    service,
    runner: { availability: () => [] },
    agentTokens: { codex: "test-codex", claude: "test-claude" },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const req = async (path, method = "GET", body, token = "test-codex") => {
    const r = await fetch(url + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: await r.json() };
  };
  return {
    store,
    service,
    project,
    stages,
    make,
    foreign,
    foreignRun,
    ticket,
    run,
    auth,
    url,
    req,
  };
}

test("resolver organization retains ownership, audit evidence, and blocker until explicitly verified", async (t) => {
  const f = await fixture(t);
  const ctx = f.service.resolutionContext(f.ticket.id, f.auth);
  assert.equal(ctx.dependencies[0].execution.reserved, true);
  assert.ok(!JSON.stringify(ctx).includes("PRIVATE FOREIGN DESCRIPTION"));
  const child = f.service.createSubtask(f.ticket.id, {
    ...f.auth,
    title: "Fix missing dependency",
    reason: "Split actionable owned work",
  });
  assert.equal(child.ownerId, "codex");
  assert.equal(child.parentId, f.ticket.id);
  assert.equal(child.stageId, f.stages.ready);
  assert.equal(f.store.active(child.id), null);
  assert.equal(f.service.getTicket(f.ticket.id).blockedReason, "dependency");
  const current = f.service.getTicket(f.ticket.id);
  const next = f.service.agentUpdate(f.ticket.id, {
    ...f.auth,
    version: current.version,
    reason: "Linked verified dependency scope",
    changes: {
      dependsOn: [child.id],
      blockedReason: "Waiting for owned subtask",
    },
  });
  assert.deepEqual(next.dependsOn, [child.id]);
  assert.equal(next.blockedReason, "Waiting for owned subtask");
  assert.equal(f.store.active(f.foreign.id).id, f.foreignRun.id);
  assert.ok(
    f.store
      .activities()
      .some(
        (a) =>
          a.kind === "agent_reorganized" &&
          a.summary === "Linked verified dependency scope" &&
          a.agentId === "codex",
      ),
  );
});

test("scoped agent writes reject stale versions, foreign sessions, completion, cycles and project changes", async (t) => {
  const f = await fixture(t);
  const update = (changes, extra = {}) =>
    f.service.agentUpdate(f.ticket.id, {
      ...f.auth,
      version: f.ticket.version,
      reason: "Evidence",
      changes,
      ...extra,
    });
  for (const changes of [
    { ownerId: "claude" },
    { archived: true },
    { projectId: "elsewhere" },
    { stageId: f.stages.done },
  ])
    assert.throws(() => update(changes));
  assert.throws(
    () => update({ title: "stale" }, { version: 0 }),
    (e) => e.code === "VERSION_CONFLICT",
  );
  assert.throws(
    () => update({ title: "spoof" }, { sessionId: "wrong" }),
    (e) => e.code === "SESSION_MISMATCH",
  );
  assert.throws(
    () => update({ title: "no evidence" }, { reason: "" }),
    (e) => e.code === "VALIDATION",
  );
  assert.throws(
    () => update({ dependsOn: [f.ticket.id] }),
    (e) => e.code === "DEPENDENCY_CYCLE",
  );
  const child = f.service.createSubtask(f.ticket.id, {
    ...f.auth,
    title: "Child",
    reason: "Split",
  });
  assert.throws(
    () => update({ parentId: child.id }),
    (e) => e.code === "PARENT_CYCLE",
  );
  const other = f.service.createProject({ name: "Other" });
  const out = f.service.createTicket({
    projectId: other.id,
    title: "Other project",
    ownerId: "codex",
  });
  assert.throws(
    () => update({ dependsOn: [out.id] }),
    (e) => e.code === "PROJECT_MISMATCH",
  );
  assert.throws(
    () =>
      f.service.agentUpdate(f.foreign.id, {
        ...f.auth,
        version: f.foreign.version,
        reason: "No",
        changes: { title: "stolen" },
      }),
    (e) => e.code === "OWNER_MISMATCH",
  );
  assert.throws(
    () =>
      f.service.createSubtask(f.ticket.id, {
        ...f.auth,
        title: "Stolen",
        reason: "No",
        ownerId: "claude",
      }),
    (e) => e.code === "AGENT_FIELDS",
  );
  f.service.event(f.run.id, {
    ...f.auth,
    eventId: "end",
    seq: 1,
    type: "checkpoint",
    summary: "Saved resolution",
  });
  assert.throws(
    () => update({ title: "after release" }),
    (e) => e.code === "SESSION_MISMATCH",
  );
});

test("HTTP derives scoped identity and never accepts resolution overrides in ordinary claims", async (t) => {
  const f = await fixture(t);
  const path = `/api/tickets/${f.ticket.id}`;
  let r = await f.req(
    `${path}/resolution-context?executionId=${f.run.id}&sessionId=resolver`,
  );
  assert.equal(r.status, 200);
  assert.equal(r.data.dependencies[0].id, f.foreign.id);
  r = await f.req(`${path}/agent-update`, "PATCH", {
    ...f.auth,
    version: f.ticket.version,
    reason: "Verified repository context",
    changes: { title: "Resolve prerequisite" },
  });
  assert.equal(r.status, 200);
  r = await f.req(`${path}/subtasks`, "POST", {
    executionId: f.run.id,
    sessionId: "resolver",
    title: "Bounded child",
    reason: "Split scope",
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.ownerId, "codex");
  r = await f.req(`${path}/subtasks`, "POST", {
    ...f.auth,
    agentId: "claude",
    title: "Spoof",
    reason: "No",
  });
  assert.equal(r.status, 403);
  r = await f.req(`/api/tickets/${f.foreign.id}/agent-update`, "PATCH", {
    ...f.auth,
    version: f.foreign.version,
    reason: "No",
    changes: { title: "Spoof" },
  });
  assert.equal(r.status, 403);
  r = await f.req(`${path}/start`, "POST", {});
  assert.equal(r.status, 403);
  const blocked = f.make({ blockedReason: "Blocked" });
  r = await f.req(`/api/tickets/${blocked.id}/claim`, "POST", {
    agentId: "codex",
    sessionId: "bypass",
    resolveBlockers: true,
    purpose: "resolve_blockers",
  });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, "BLOCKED");
  assert.equal(f.store.active(blocked.id), null);
  r = await f.req("/api/agents/status");
  assert.equal(r.status, 403);
  r = await f.req("/api/agents/status/refresh", "POST", {});
  assert.equal(r.status, 403);
});

test("MCP organization tools reach scoped server and preserve actor identity", async (t) => {
  const f = await fixture(t);
  const calls = [
    {
      name: "desk_get_resolution_context",
      arguments: {
        ticketId: f.ticket.id,
        executionId: f.run.id,
        sessionId: "resolver",
      },
    },
    {
      name: "desk_update_task",
      arguments: {
        ticketId: f.ticket.id,
        executionId: f.run.id,
        sessionId: "resolver",
        version: f.ticket.version,
        reason: "Verified reproduction",
        changes: { title: "MCP resolved scope" },
      },
    },
    {
      name: "desk_create_subtask",
      arguments: {
        ticketId: f.ticket.id,
        executionId: f.run.id,
        sessionId: "resolver",
        reason: "Split safe work",
        title: "MCP child",
      },
    },
  ];
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("../bin/mcp.mjs", import.meta.url)),
      "--agent",
      "codex",
    ],
    {
      env: {
        ...process.env,
        AGENT_DESK_URL: f.url,
        AGENT_DESK_TOKEN: "test-codex",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.resume();
  child.stdin.end(
    calls
      .map((params, i) =>
        JSON.stringify({
          jsonrpc: "2.0",
          id: i + 1,
          method: "tools/call",
          params,
        }),
      )
      .join("\n") + "\n",
  );
  const code = await new Promise((r) => child.once("exit", r));
  assert.equal(code, 0);
  const rows = out.trim().split("\n").map(JSON.parse);
  assert.equal(rows.length, 3);
  assert.ok(
    rows.every((r) => !r.result.isError),
    out,
  );
  assert.equal(f.service.getTicket(f.ticket.id).title, "MCP resolved scope");
  assert.equal(f.store.active(f.foreign.id).id, f.foreignRun.id);
  assert.ok(!out.includes("test-codex"));
});

test("managed completion through legacy HTTP checkpoints unresolved work and preserves replay", async (t) => {
  const f = await fixture(t);
  f.store.saveExecution({ ...f.run, managedBy: "agent-desk" });
  const input = {
    agentId: "codex",
    sessionId: f.run.sessionId,
    eventId: "legacy-managed-terminal",
    seq: 1,
    type: "complete",
    summary: "Result still needs dependency",
  };
  const first = await f.req(
    `/api/executions/${f.run.id}/events`,
    "POST",
    input,
  );
  assert.equal(first.status, 200);
  assert.equal(first.data.state, "checkpointed");
  assert.match(first.data.summary, /Unresolved blockers/);
  const repeat = await f.req(
    `/api/executions/${f.run.id}/events`,
    "POST",
    input,
  );
  assert.equal(repeat.status, 200);
  assert.equal(repeat.data.state, "checkpointed");
  assert.equal(f.store.active(f.foreign.id).id, f.foreignRun.id);
});
