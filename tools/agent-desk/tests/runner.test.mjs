import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../server/store.mjs";
import { Service } from "../server/service.mjs";
import { Runner } from "../server/runner.mjs";

function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "desk-runner-")));
  const repo = join(dir, "source repo");
  const bin = join(dir, "bin");
  const dataDir = join(dir, "desk data");
  mkdirSync(repo);
  mkdirSync(bin);
  mkdirSync(join(dir, "empty-hooks"));
  const git = (...args) =>
    execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "--initial-branch=main");
  git("config", "core.hooksPath", join(dir, "empty-hooks"));
  git("config", "user.name", "Runner fixture");
  git("config", "user.email", "runner@example.invalid");
  writeFileSync(join(repo, "README.md"), "Committed source\n");
  git("add", "README.md");
  git(
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--no-gpg-sign",
    "-m",
    "Fixture base",
  );
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  const base = git("rev-parse", "HEAD");
  // Preserve a dirty shared checkout while the runner isolates the fetched base.
  writeFileSync(join(repo, "README.md"), "User-owned local change\n");
  const record = join(dir, "fake-invocation.json");
  const fake = join(bin, "codex");
  writeFileSync(
    fake,
    `#!${process.execPath}\nimport fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(record)},JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),env:Object.fromEntries(['AGENT_DESK_URL','AGENT_DESK_TICKET_ID','AGENT_DESK_EXECUTION_ID','AGENT_DESK_SESSION_ID','AGENT_DESK_AGENT_ID','AGENT_DESK_ADMIN_TOKEN','AGENT_DESK_TOKEN','AGENT_DESK_BRIDGE_DIR'].map(k=>[k,process.env[k]]))}));\nprocess.stdout.write(JSON.stringify({type:'thread.started'})+'\\n');\nprocess.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Fixture progress observed'}})+'\\n');\nsetTimeout(()=>process.exit(0),80);\n`,
    { mode: 0o700 },
  );
  const originalPath = process.env.PATH;
  process.env.PATH = bin + delimiter + originalPath;
  const store = new Store(join(dir, "target.db"));
  const service = new Service(store);
  const project = service.createProject({
    name: "Runner",
    key: "RUN",
    path: repo,
  });
  const runner = new Runner(service, {
    dataDir,
    url: "http://127.0.0.1:9999",
    agentTokens: { codex: "scoped-fixture-token" },
  });
  t.after(async () => {
    runner.coordinator.close();
    for (const child of runner.children.values()) {
      await new Promise((resolve) => {
        child.once("close", resolve);
        child.kill("SIGTERM");
      });
    }
    process.env.PATH = originalPath;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const ticket = (extra = {}) =>
    service.createTicket({
      projectId: project.id,
      title: "Fixture work",
      ownerId: "codex",
      stageId: service
        .state()
        .stages.find((s) => s.projectId === project.id && s.role === "ready")
        .id,
      ...extra,
    });
  return {
    dir,
    repo,
    bin,
    record,
    dataDir,
    store,
    service,
    project,
    runner,
    ticket,
    git,
    base,
  };
}
function completed(service, ticketId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      service.off("change", check);
      reject(new Error("Fake runner did not complete within deadline"));
    }, 5000);
    const check = () => {
      const execution = service.getTicket(ticketId).execution;
      if (execution?.releasedAt) {
        clearTimeout(timer);
        service.off("change", check);
        resolve(execution);
      }
    };
    service.on("change", check);
    check();
  });
}

test("automatic blocked, backlog, dependency-held and already-claimed tickets never spawn a process or worktree", (t) => {
  const f = fixture(t);
  const blocked = f.ticket({ blockedReason: "Needs decision" });
  const backlog = f.ticket({
    stageId: f.service
      .state()
      .stages.find((s) => s.projectId === f.project.id && s.role === "backlog")
      .id,
  });
  const prerequisite = f.ticket();
  const dependent = f.ticket({ dependsOn: [prerequisite.id] });
  const claimed = f.ticket();
  const original = f.service.claim(claimed.id, {
    agentId: "codex",
    sessionId: "original-executor",
  });
  for (const [ticket, code] of [
    [blocked, "BLOCKED"],
    [backlog, "STAGE_HOLD"],
    [dependent, "DEPENDENCY_HOLD"],
    [claimed, "ALREADY_CLAIMED"],
  ])
    assert.throws(
      () => f.runner.start(ticket.id, { automatic: true }),
      (error) => error.code === code,
    );
  assert.equal(existsSync(f.record), false);
  assert.equal(existsSync(join(f.dataDir, "worktrees")), false);
  assert.equal(f.store.active(claimed.id).id, original.id);
  assert.equal(f.runner.children.size, 0);
  assert.equal(
    f.git("worktree", "list", "--porcelain").match(/^worktree /gm).length,
    1,
  );
});

test("fixed executable argv runs only in an isolated base worktree and streams progress before completion", async (t) => {
  const f = fixture(t);
  const ticket = f.ticket();
  const result = f.runner.start(ticket.id);
  const end = await completed(f.service, ticket.id);
  assert.equal(end.state, "checkpointed");
  assert.equal(end.external, false);
  assert.ok(end.releasedAt);
  assert.equal(f.store.active(ticket.id), null);
  assert.equal(f.runner.children.size, 0);
  const call = JSON.parse(readFileSync(f.record, "utf8"));
  assert.deepEqual(call.args.slice(0, 2), ["exec", "--json"]);
  assert.equal(call.args.length, 3);
  assert.equal(call.cwd, result.worktreePath);
  assert.notEqual(call.cwd, f.repo);
  assert.equal(
    execFileSync("git", ["-C", call.cwd, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    f.base,
  );
  assert.equal(
    readFileSync(join(call.cwd, "README.md"), "utf8"),
    "Committed source\n",
  );
  assert.equal(
    readFileSync(join(f.repo, "README.md"), "utf8"),
    "User-owned local change\n",
  );
  assert.equal(f.git("branch", "--show-current"), "main");
  assert.match(end.branch, /^codex\/desk-/);
  assert.deepEqual(call.env, {
    AGENT_DESK_URL: "http://127.0.0.1:9999",
    AGENT_DESK_TICKET_ID: ticket.id,
    AGENT_DESK_EXECUTION_ID: result.id,
    AGENT_DESK_SESSION_ID: result.sessionId,
    AGENT_DESK_AGENT_ID: "codex",
    AGENT_DESK_BRIDGE_DIR: call.env.AGENT_DESK_BRIDGE_DIR,
  });
  assert.ok(
    call.env.AGENT_DESK_BRIDGE_DIR.startsWith(
      join(result.worktreePath, `.agent-desk-${result.id}-`),
    ),
  );
  const activity = f.store.activities().filter((a) => a.ticketId === ticket.id);
  assert.ok(
    activity.some(
      (a) => a.kind === "progress" && a.summary === "Fixture progress observed",
    ),
  );
  assert.ok(
    activity.some(
      (a) =>
        a.kind === "checkpoint" &&
        /without a terminal task report/.test(a.summary),
    ),
  );
  assert.equal(
    f.store.get("stage", f.service.getTicket(ticket.id).stageId).role,
    "active",
    "process completion is not delivery",
  );
});

test("shell metacharacters in ticket context are passed literally and never execute", async (t) => {
  const f = fixture(t);
  const marker = join(f.dir, "unexpected-shell-write");
  const title = `Task $(touch '${marker}') \`touch '${marker}'\``;
  const description = `'; touch '${marker}'; #\n--cd /tmp; echo malicious`;
  const ticket = f.ticket({ title, description });
  f.runner.start(ticket.id);
  await completed(f.service, ticket.id);
  assert.equal(existsSync(marker), false);
  const call = JSON.parse(readFileSync(f.record, "utf8"));
  assert.equal(call.args.length, 3);
  assert.ok(call.args[2].includes(title));
  const payload = JSON.parse(
    call.args[2].slice(call.args[2].indexOf('{\n  "title"')),
  );
  assert.equal(payload.description, description);
});

test("stopping an external execution refuses without changing or releasing the claim", (t) => {
  const f = fixture(t);
  const ticket = f.ticket();
  const run = f.service.claim(ticket.id, {
    agentId: "codex",
    sessionId: "outside-session",
    external: true,
  });
  assert.throws(
    () => f.runner.stop(ticket.id),
    (error) => error.code === "EXTERNAL_EXECUTION",
  );
  assert.equal(f.store.active(ticket.id).id, run.id);
  assert.equal(f.store.execution(run.id).releasedAt, null);
  assert.equal(existsSync(f.record), false);
});

test("server administrator authority is absent from agent child environment", async (t) => {
  const previous = process.env.AGENT_DESK_ADMIN_TOKEN;
  process.env.AGENT_DESK_ADMIN_TOKEN = "admin-sentinel-do-not-forward";
  t.after(() => {
    if (previous === undefined) delete process.env.AGENT_DESK_ADMIN_TOKEN;
    else process.env.AGENT_DESK_ADMIN_TOKEN = previous;
  });
  const f = fixture(t);
  const ticket = f.ticket();
  f.runner.start(ticket.id);
  await completed(f.service, ticket.id);
  const { env } = JSON.parse(readFileSync(f.record, "utf8"));
  assert.equal(env.AGENT_DESK_ADMIN_TOKEN, undefined);
  assert.equal(env.AGENT_DESK_TOKEN, undefined);
  assert.ok(env.AGENT_DESK_BRIDGE_DIR);
});

test("explicit Start launches a blocked Backlog ticket as a resolution pass", async (t) => {
  const f = fixture(t);
  const dependency = f.ticket({ ownerId: "claude" });
  const foreign = f.service.claim(dependency.id, {
    agentId: "claude",
    sessionId: "foreign-worker",
  });
  const ticket = f.ticket({
    blockedReason: "dependency",
    dependsOn: [dependency.id],
    stageId: f.service
      .state()
      .stages.find((s) => s.projectId === f.project.id && s.role === "backlog")
      .id,
  });
  const run = f.runner.start(ticket.id);
  assert.equal(run.purpose, "resolve_blockers");
  await completed(f.service, ticket.id);
  const call = JSON.parse(readFileSync(f.record, "utf8"));
  assert.match(call.args[2], /resolve_blockers/);
  assert.match(call.args[2], /desk_update_task/);
  assert.match(call.args[2], /foreign-worker|reserved/);
  assert.equal(f.service.getTicket(ticket.id).blockedReason, "dependency");
  assert.deepEqual(f.service.getTicket(ticket.id).dependsOn, [dependency.id]);
  assert.equal(f.store.active(dependency.id).id, foreign.id);
  assert.equal(
    f.store.get("stage", f.service.getTicket(ticket.id).stageId).role,
    "active",
  );
});

test("a blocked resolver exiting zero without a terminal report is checkpointed with its last useful summary", async (t) => {
  const f = fixture(t);
  const ticket = f.ticket({
    blockedReason: "Original source session must be reconciled",
  });
  f.runner.start(ticket.id);
  const end = await completed(f.service, ticket.id);
  assert.equal(end.state, "checkpointed");
  assert.match(end.summary, /Fixture progress observed/);
  assert.match(end.summary, /checkpoint|report|block/i);
  assert.equal(
    f.service.getTicket(ticket.id).blockedReason,
    ticket.blockedReason,
  );
});

for (const clear of [false, true]) {
  test(`managed helper terminal report is preserved with blocker cleared=${clear}`, async (t) => {
    const f = fixture(t),
      ticket = f.ticket({ blockedReason: "Synthetic dependency" });
    const client = new URL("../bin/managed-client.mjs", import.meta.url).href;
    writeFileSync(
      join(f.bin, "codex"),
      `#!${process.execPath}\nimport {managedRequest} from ${JSON.stringify(client)};\nconst directory=process.env.AGENT_DESK_BRIDGE_DIR;\nprocess.stdout.write(JSON.stringify({type:'thread.started',thread_id:'01234567-89ab-cdef-0123-456789abcdef'})+'\\n');\nconst ticket=await managedRequest(directory,'get_task');\n${clear ? "await managedRequest(directory,'update_task',{version:ticket.version,reason:'Fixture dependency proven resolved',changes:{blockedReason:''}});" : ""}\nawait managedRequest(directory,'report_progress',{type:'complete',summary:'Exact verified fixture result',eventId:'fixture-terminal'});\nprocess.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Post-report prose must not overwrite the terminal result'}})+'\\n');\n`,
      { mode: 0o700 },
    );
    f.runner.start(ticket.id);
    const end = await completed(f.service, ticket.id);
    assert.equal(end.state, clear ? "awaiting_review" : "checkpointed");
    assert.match(end.summary, /Exact verified fixture result/);
    if (!clear) assert.match(end.summary, /Unresolved blockers/);
    assert.ok(end.reportingReadyAt);
    assert.equal(end.nativeSessionId, "01234567-89ab-cdef-0123-456789abcdef");
    assert.equal(end.nativeSessionSource, "runner");
    const child = f.runner.children.get(end.id);
    if (child) await new Promise((r) => child.once("close", r));
    assert.equal(f.store.execution(end.id).summary, end.summary);
  });
}
