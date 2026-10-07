import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Store } from "../server/store.mjs";
import { Service } from "../server/service.mjs";
import { createAppServer } from "../server/http.mjs";

async function fixture(t) {
  const store = new Store(":memory:"), service = new Service(store);
  const project = service.createProject({ name: "Scope release", repo: "fixture/scope" });
  const stages = Object.fromEntries(store.list("stage", project.id).map(s => [s.role, s.id]));
  const make = (name, extra = {}) => service.createTicket({
    projectId: project.id, title: name, ownerId: "codex", stageId: stages.ready,
    description: "Original reviewed contribution and immutable source SHA",
    brief: { specification: "Original spec", acceptanceCriteria: "Original acceptance",
      scope: "Original frozen contribution", verification: "Original full release proofs",
      allowedPaths: `fixtures/${name}/**`, conflictKeys: "none" }, ...extra,
  });
  const source = make("source"), target = make("target", { ownerId: "claude" });
  const run = service.claim(source.id, { agentId: "codex", sessionId: "native-source" });
  const targetRun = service.claim(target.id, { agentId: "claude", sessionId: "native-lead" });
  service.updateTicket(source.id, { version: service.getTicket(source.id).version,
    blockedReason: "Integrated acceptance, merge and installed proof unfinished" });
  service.event(run.id, { agentId: "codex", sessionId: run.sessionId, seq: 1,
    eventId: "frozen-checkpoint", type: "checkpoint", summary: "Reviewed contribution frozen",
    headSha: "a".repeat(40) });
  const input = { agentId: "codex", executionId: run.id, sessionId: run.sessionId,
    version: service.getTicket(source.id).version, targetTicketId: target.id,
    reason: "Human-approved reviewed contribution handoff", reviewerId: "independent-reviewer",
    reviewEvidence: "Exact source head reviewed; acceptance remains unfinished" };
  const server = createAppServer({ service, runner: { availability: () => [] },
    agentTokens: { codex: "fixture-codex", claude: "fixture-claude" } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); store.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const req = async (body = input, token = "fixture-codex", method = "POST", suffix = "") => {
    const r = await fetch(`${url}/api/tickets/${source.id}/release-scope${suffix}`, {
      method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, data: await r.json() };
  };
  return { store, service, project, stages, make, source, target, run, targetRun, input, url, req };
}

test("own released checkpoint releases only future scope without a resolution grant", async t => {
  const f = await fixture(t);
  const before = f.service.getTicket(f.source.id), targetBefore = f.service.getTicket(f.target.id);
  const executionBefore = f.store.execution(f.run.id);
  assert.equal(f.store.get("resolution-grant", f.source.id), null);
  const result = await f.req();
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const after = f.service.getTicket(f.source.id);
  assert.equal(after.stageId, f.stages.planning);
  assert.equal(after.brief.allowedPaths, ""); assert.equal(after.brief.conflictKeys, "none");
  for (const key of ["ownerId", "parentId", "dependsOn", "blockedReason", "github", "resumeReason"])
    assert.deepEqual(after[key], before[key], key);
  for (const key of ["specification", "acceptanceCriteria", "verification", "scope"])
    assert.equal(after.brief[key], before.brief[key], key);
  assert.ok(after.description.startsWith(before.description));
  for (const value of [before.brief.allowedPaths, f.target.id, f.run.id, f.run.sessionId,
    f.targetRun.id, f.input.reviewEvidence, executionBefore.headSha]) assert.ok(after.description.includes(value), value);
  assert.deepEqual(f.store.execution(f.run.id), executionBefore);
  assert.deepEqual(f.service.getTicket(f.target.id), targetBefore);
  assert.equal(f.store.active(f.source.id), null);
  assert.throws(() => f.service.claim(f.source.id, { agentId: "codex", sessionId: "new-implementation" }),
    e => e.code === "BLOCKED" || e.code === "READINESS_HOLD");
  assert.ok(f.store.activities().some(a => a.kind === "scope_released" && a.agentId === "codex"));
});

test("resolution checkpoints can release scope but active and held executions cannot", async t => {
  const f = await fixture(t);
  f.store.saveExecution({ ...f.store.execution(f.run.id), purpose: "resolve_blockers" });
  assert.equal((await f.req()).status, 200);
  const held = await fixture(t);
  held.store.saveExecution({ ...held.store.execution(held.run.id), heldSessions: [{ id: "child-native", releasedAt: null }] });
  assert.equal((await held.req()).status, 409);
  const active = await fixture(t);
  active.service.authorizeResolution(active.source.id, { version: active.input.version,
    agentId: "codex", sessionId: "resolver", reason: "Fixture bounded resolution" });
  active.service.claim(active.source.id, { agentId: "codex", sessionId: "resolver", resolutionReason: "Fixture bounded resolution" }, { resolveBlockers: true });
  const before = active.service.getTicket(active.source.id);
  assert.equal((await active.req()).status, 409);
  assert.deepEqual(active.service.getTicket(active.source.id), before);
});

test("identity, version, input and target failures are non-mutating", async t => {
  const variants = [
    [{ sessionId: "foreign-native" }, 403], [{ executionId: "wrong-execution" }, 403],
    [{ version: 1 }, 409], [{ version: 0 }, 422], [{ reason: "" }, 422],
    [{ reviewerId: "codex" }, 422], [{ reviewEvidence: "" }, 422],
    [{ reason: "x".repeat(2001) }, 422], [{ changes: { ownerId: "claude" } }, 422],
  ];
  for (const [patch, expected] of variants) {
    const f = await fixture(t), before = f.service.getTicket(f.source.id);
    const r = await f.req({ ...f.input, ...patch });
    assert.equal(r.status, expected, JSON.stringify({ patch, r }));
    assert.deepEqual(f.service.getTicket(f.source.id), before);
  }
  const f = await fixture(t), before = f.service.getTicket(f.source.id);
  assert.equal((await f.req(f.input, "fixture-claude")).status, 403);
  assert.equal((await f.req({ ...f.input, agentId: "claude" })).status, 403);
  assert.equal((await f.req({ ...f.input, targetTicketId: f.source.id })).status, 422);
  const foreignProject = f.service.createProject({ name: "Foreign" });
  const foreign = f.service.createTicket({ projectId: foreignProject.id, title: "Foreign target", ownerId: "claude" });
  assert.equal((await f.req({ ...f.input, targetTicketId: foreign.id })).status, 422);
  const idle = f.make("idle-target", { stageId: f.stages.planning });
  assert.equal((await f.req({ ...f.input, targetTicketId: idle.id })).status, 409);
  assert.deepEqual(f.service.getTicket(f.source.id), before);
});

test("archive, completed/review work, parent and superseded checkpoint cannot release", async t => {
  for (const mutate of [
    f => f.service.updateTicket(f.source.id, { version: f.input.version, archived: true }),
    f => f.store.put("ticket", { ...f.service.getTicket(f.source.id), stageId: f.stages.review }),
    f => f.store.put("ticket", { ...f.service.getTicket(f.source.id), stageId: f.stages.done }),
    f => f.make("child", { parentId: f.source.id, stageId: f.stages.planning }),
    f => f.store.saveExecution({ ...f.store.execution(f.run.id), id: crypto.randomUUID() }),
  ]) {
    const f = await fixture(t); mutate(f); const before = f.service.getTicket(f.source.id);
    const r = await f.req({ ...f.input, version: before.version });
    assert.ok([403, 409].includes(r.status), JSON.stringify(r));
    assert.deepEqual(f.service.getTicket(f.source.id), before);
  }
});

test("concurrent replay has one winner and receipt failure rolls back scope", async t => {
  const f = await fixture(t);
  const results = await Promise.all([f.req(), f.req()]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(f.store.activities().filter(a => a.kind === "scope_released").length, 1);
  const rollback = await fixture(t), before = rollback.service.getTicket(rollback.source.id);
  const activity = rollback.store.activity.bind(rollback.store);
  rollback.store.activity = (...args) => { if (args[1] === "scope_released") throw Error("receipt unavailable"); return activity(...args); };
  assert.equal((await rollback.req()).status, 500);
  assert.deepEqual(rollback.service.getTicket(rollback.source.id), before);
});

async function clientProcess(f, args, messages) {
  const child = spawn(process.execPath, args, { env: { ...process.env,
    AGENT_DESK_URL: f.url, AGENT_DESK_TOKEN: "fixture-codex" }, stdio: ["pipe", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", d => out += d); child.stderr.on("data", d => err += d);
  child.stdin.end(messages ?? "");
  const code = await new Promise(resolve => child.on("exit", resolve));
  return { out, err, code };
}

test("stdio MCP exposes and dispatches grant-free exact-session release", async t => {
  const f = await fixture(t); const { agentId, ...args } = f.input;
  const r = await clientProcess(f, [fileURLToPath(new URL("../bin/mcp.mjs", import.meta.url)), "--agent", "codex"],
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "desk_release_scope", arguments: { ticketId: f.source.id, ...args } } }) + "\n");
  assert.equal(r.code, 0, r.err);
  const response = JSON.parse(r.out.trim());
  assert.equal(response.result?.isError, undefined, r.out);
  assert.equal(f.service.getTicket(f.source.id).stageId, f.stages.planning);
  assert.ok(!r.out.includes("fixture-codex"));
});

test("CLI release-scope uses configured agent credentials and the same fixed API", async t => {
  const f = await fixture(t);
  const r = await clientProcess(f, [fileURLToPath(new URL("../bin/desk.mjs", import.meta.url)),
    "release-scope", f.source.id, "--agent", "codex", "--execution", f.run.id,
    "--session", f.run.sessionId, "--version", String(f.input.version), "--target", f.target.id,
    "--reason", f.input.reason, "--reviewer", f.input.reviewerId, "--review-evidence", f.input.reviewEvidence]);
  assert.equal(r.code, 0, r.err);
  assert.equal(f.service.getTicket(f.source.id).stageId, f.stages.planning);
});
