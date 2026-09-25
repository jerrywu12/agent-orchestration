import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Store } from "../server/store.mjs";
import { Service } from "../server/service.mjs";
import { createAppServer } from "../server/http.mjs";

const run = promisify(execFile);
const cli = fileURLToPath(new URL("../bin/desk.mjs", import.meta.url));
const brief = {
  specification: "spec.md",
  acceptanceCriteria: "Exact source parser works",
  scope: "One parser and its tests",
  verification: "Run focused and full tests",
  allowedPaths: "src/percent_script.py",
  conflictKeys: "percent-script-intake",
};

test("operator CLI confirms an existing-session Ready admission without launching another agent", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const service = new Service(store);
  const project = service.createProject({ name: "Fixture", repo: "org/repo" });
  const planning = store.list("stage", project.id).find((stage) => stage.role === "planning");
  const ready = store.list("stage", project.id).find((stage) => stage.role === "ready");
  const ticket = service.createTicket({
    projectId: project.id, title: "Intake", ownerId: "codex",
    stageId: planning.id, brief,
  });
  let launches = 0;
  const runner = {
    availability: () => [{ id: "codex", available: false, reason: "Managed runner unavailable" }],
    start: () => { launches++; throw Error("must not launch managed agent"); },
  };
  const server = createAppServer({
    service, runner, adminToken: "admin-fixture", agentTokens: { codex: "agent-fixture" },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const env = {
    ...process.env,
    AGENT_DESK_URL: `http://127.0.0.1:${server.address().port}`,
    AGENT_DESK_TOKEN: "admin-fixture",
    AGENT_DESK_AGENT_ID: "codex",
  };
  const args = [
    cli, "admit-existing", ticket.id, "--agent", "codex",
    "--version", String(ticket.version), "--confirm",
  ];

  const { stdout } = await run(process.execPath, args, { env });
  assert.equal(JSON.parse(stdout).outcome, "awaiting_claim");
  assert.equal(service.getTicket(ticket.id).stageId, ready.id);
  assert.equal(store.get("launch-intent", ticket.id).status, "awaiting_claim");
  assert.equal(launches, 0);

  const claim = service.claim(ticket.id, {
    agentId: "codex", sessionId: "native-codex-session", external: true,
  });
  assert.equal(claim.purpose, "implementation");
  assert.equal(store.get("launch-intent", ticket.id).sessionId, "native-codex-session");
});

test("operator CLI requires confirmation and refuses an agent-scoped credential", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const service = new Service(store);
  const project = service.createProject({ name: "Fixture", repo: "org/repo" });
  const planning = store.list("stage", project.id).find((stage) => stage.role === "planning");
  const ticket = service.createTicket({
    projectId: project.id, title: "Intake", ownerId: "codex",
    stageId: planning.id, brief,
  });
  const server = createAppServer({
    service, adminToken: "admin-fixture", agentTokens: { codex: "agent-fixture" },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const env = {
    ...process.env,
    AGENT_DESK_URL: `http://127.0.0.1:${server.address().port}`,
    AGENT_DESK_TOKEN: "admin-fixture",
  };
  const base = [
    cli, "admit-existing", ticket.id, "--agent", "codex",
    "--version", String(ticket.version),
  ];
  await assert.rejects(run(process.execPath, base, { env }), /confirm/i);
  assert.equal(service.getTicket(ticket.id).stageId, planning.id);

  await assert.rejects(
    run(process.execPath, [...base, "--confirm"], {
      env: { ...env, AGENT_DESK_TOKEN: "agent-fixture" },
    }),
    /403|Agent credentials|scope/i,
  );
  assert.equal(service.getTicket(ticket.id).stageId, planning.id);
});

test("operator CLI does not silently reopen review or delivered work", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const service = new Service(store);
  const project = service.createProject({ name: "Fixture", repo: "org/repo" });
  const stages = Object.fromEntries(
    store.list("stage", project.id).map((stage) => [stage.role, stage]),
  );
  const tickets = ["review", "done"].map((role) => service.createTicket({
    projectId: project.id, title: role, ownerId: "codex",
    stageId: stages[role].id, brief,
  }));
  const server = createAppServer({ service, adminToken: "admin-fixture" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const env = {
    ...process.env,
    AGENT_DESK_URL: `http://127.0.0.1:${server.address().port}`,
    AGENT_DESK_TOKEN: "admin-fixture",
  };

  for (const ticket of tickets) {
    await assert.rejects(
      run(process.execPath, [
        cli, "admit-existing", ticket.id, "--agent", "codex",
        "--version", String(ticket.version), "--confirm",
      ], { env }),
      /Backlog or Planning/,
    );
    assert.equal(service.getTicket(ticket.id).stageId, ticket.stageId);
    assert.equal(store.get("launch-intent", ticket.id), null);
  }
});
