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
  const project = service.createProject({
    name: "Resolution",
    repo: "fixture/resolution",
  });
  const stages = Object.fromEntries(
    store.list("stage", project.id).map((s) => [s.role, s.id]),
  );
  const make = (extra = {}) =>
    service.createTicket({
      projectId: project.id,
      title: "Assigned work",
      brief: {
        specification: "Fixture specification",
        acceptanceCriteria: "Verify the behavior under test",
        scope: "Isolated fixture implementation",
        verification: "Run the focused fixture assertions",
        allowedPaths: `fixtures/${crypto.randomUUID()}/**`,
        conflictKeys: "none",
      },
      ownerId: "codex",
      stageId:
        extra.blockedReason || extra.dependsOn?.length
          ? stages.active
          : stages.ready,
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
  const resolutionReason = "Test fixture authorizes bounded dependency review";
  service.authorizeResolution(ticket.id, {
    version: ticket.version,
    agentId: "codex",
    sessionId: "resolver",
    reason: resolutionReason,
  });
  const run = service.claim(
    ticket.id,
    { agentId: "codex", sessionId: "resolver", resolutionReason },
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
        ...(token ? { authorization: `Bearer ${token}` } : {}),
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
  assert.equal(child.stageId, f.stages.planning);
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
  assert.equal(r.data.error.code, "NOT_READY");
  assert.match(r.data.error.message, /blocked/i);
  assert.equal(f.store.active(blocked.id), null);
  r = await f.req("/api/agents/status");
  assert.equal(r.status, 403);
  r = await f.req("/api/agents/status/refresh", "POST", {});
  assert.equal(r.status, 403);
});

test("explicit assigned resolution claim reopens a blocked parent for child planning without implementation", async (t) => {
  const f = await fixture(t);
  const parent = f.make({
    stageId: f.stages.active,
    blockedReason: "Controlled acceptance remains open",
  });
  const deliveredChild = f.make({ parentId: parent.id, stageId: f.stages.done });
  const path = `/api/tickets/${parent.id}`;
  let denied = await f.req(`${path}/claim`, "POST", {
    agentId: "codex",
    sessionId: "parent-planner",
    resolutionReason: "Owner authorized a bounded child-planning pass for controlled C1",
  });
  assert.equal(denied.status, 409);
  assert.equal(denied.data.error.code, "RESOLUTION_AUTH_REQUIRED");
  denied = await f.req(`${path}/authorize-resolution`, "POST", {
    version: parent.version,
    agentId: "codex",
    sessionId: "parent-planner",
    reason: "Spoofed operator approval",
  });
  assert.equal(denied.status, 403);
  denied = await f.req(`${path}/authorize-resolution`, "POST", {
    version: parent.version,
    agentId: "codex",
    sessionId: "parent-planner",
    reason: "Owner authorized a bounded child-planning pass for controlled C1",
  }, null);
  assert.equal(denied.status, 200);
  denied = await f.req(`${path}/claim`, "POST", {
    agentId: "codex",
    sessionId: "different-native-session",
    resolutionReason: "Owner authorized a bounded child-planning pass for controlled C1",
  });
  assert.equal(denied.status, 409);
  assert.equal(denied.data.error.code, "RESOLUTION_AUTH_REQUIRED");
  denied = await f.req(`${path}/claim`, "POST", {
    agentId: "codex",
    sessionId: "parent-planner",
    resolutionReason: "Different scope",
  });
  assert.equal(denied.status, 409);
  assert.equal(denied.data.error.code, "RESOLUTION_AUTH_REQUIRED");
  let r = await f.req(`${path}/claim`, "POST", {
    agentId: "codex",
    sessionId: "parent-planner",
  });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, "NOT_READY");
  r = await f.req(`${path}/claim`, "POST", {
    agentId: "codex",
    sessionId: "parent-planner",
    resolutionReason: "Owner authorized a bounded child-planning pass for controlled C1",
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.purpose, "resolve_blockers");
  const executionId = r.data.id;
  r = await f.req(`${path}/claim`, "POST", {
    agentId: "codex",
    sessionId: "parent-planner",
    resolutionReason: "Retry same claim",
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.id, executionId);
  r = await f.req(`${path}/subtasks`, "POST", {
    executionId,
    sessionId: "parent-planner",
    reason: "Separate controlled C1 replay work",
    title: "Controlled C1 replay",
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.ownerId, "codex");
  assert.equal(r.data.parentId, parent.id);
  assert.equal(r.data.stageId, f.stages.planning);
  assert.equal(f.service.getTicket(parent.id).blockedReason, "Controlled acceptance remains open");
  assert.equal(f.service.getTicket(parent.id).coordination.role, "coordinator");
  assert.equal(f.store.active(deliveredChild.id), null);
  assert.equal(f.store.active(r.data.id), null);
  assert.ok(f.store.activities().some((a) =>
    a.kind === "resolution_claimed" && a.summary.includes("Owner authorized")));
  assert.equal(f.store.get("resolution-grant", parent.id), null);
  const foreign = await f.req(`${path}/claim`, "POST", {
    agentId: "claude",
    sessionId: "foreign",
    resolutionReason: "Spoof",
  }, "test-claude");
  assert.equal(foreign.status, 409);
  assert.equal(foreign.data.error.code, "ALREADY_CLAIMED");
});

test("operator resolution grant is version-bound and cannot transfer ownership", async (t) => {
  const f = await fixture(t);
  const ticket = f.make({ stageId: f.stages.active, blockedReason: "Needs scoped review" });
  const path = `/api/tickets/${ticket.id}`;
  let r = await f.req(`${path}/authorize-resolution`, "POST", {
    version: ticket.version,
    agentId: "claude",
    reason: "Wrong owner",
  }, null);
  assert.equal(r.status, 403);
  r = await f.req(`${path}/authorize-resolution`, "POST", {
    version: ticket.version,
    agentId: "codex",
    sessionId: "stale-grant",
    reason: "Review a verified scope",
  }, null);
  assert.equal(r.status, 200);
  const current = f.service.getTicket(ticket.id);
  f.service.updateTicket(ticket.id, { version: current.version, description: "Scope changed" });
  r = await f.req(`${path}/claim`, "POST", {
    agentId: "codex",
    sessionId: "stale-grant",
    resolutionReason: "Review a verified scope",
  });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, "RESOLUTION_AUTH_REQUIRED");
  assert.equal(f.store.active(ticket.id), null);
});

test("resolution claim requires a real hold and cannot be enabled with arbitrary override flags", async (t) => {
  const f = await fixture(t);
  const clear = f.make({ stageId: f.stages.ready });
  const path = `/api/tickets/${clear.id}/claim`;
  let r = await f.req(path, "POST", {
    agentId: "codex",
    sessionId: "no-hold",
    resolutionReason: "No actual blocker",
  });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, "RESOLUTION_NOT_NEEDED");
  const otherOwner = f.make({ ownerId: "claude", blockedReason: "Needs owner review" });
  r = await f.req(`/api/tickets/${otherOwner.id}/claim`, "POST", {
    agentId: "codex",
    sessionId: "wrong-owner",
    resolutionReason: "Spoof",
  });
  assert.equal(r.status, 403);
  assert.equal(r.data.error.code, "OWNER_MISMATCH");
  r = await f.req(`/api/tickets/${otherOwner.id}/claim`, "POST", {
    agentId: "claude",
    sessionId: "empty-reason",
    resolutionReason: "",
  }, "test-claude");
  assert.equal(r.status, 422);
  assert.equal(f.store.active(otherOwner.id), null);
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
