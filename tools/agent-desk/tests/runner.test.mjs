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
    `#!${process.execPath}\nimport fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(record)},JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),env:Object.fromEntries(['AGENT_DESK_URL','AGENT_DESK_TICKET_ID','AGENT_DESK_EXECUTION_ID','AGENT_DESK_SESSION_ID','AGENT_DESK_AGENT_ID','AGENT_DESK_ADMIN_TOKEN','AGENT_DESK_TOKEN'].map(k=>[k,process.env[k]]))}));\nprocess.stdout.write(JSON.stringify({type:'thread.started'})+'\\n');\nprocess.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Fixture progress observed'}})+'\\n');\nsetTimeout(()=>process.exit(0),80);\n`,
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
    for (const child of runner.children.values()) {
      await new Promise((resolve) => {
        child.once("exit", resolve);
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
        .stages.find((s) => s.projectId === project.id && s.role === "planning")
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

test("blocked, backlog, dependency-held and already-claimed tickets never spawn a process or worktree", (t) => {
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
      () => f.runner.start(ticket.id),
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
  assert.equal(end.state, "awaiting_review");
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
    AGENT_DESK_TOKEN: "scoped-fixture-token",
  });
  const activity = f.store.activities().filter((a) => a.ticketId === ticket.id);
  assert.ok(
    activity.some(
      (a) => a.kind === "progress" && a.summary === "Fixture progress observed",
    ),
  );
  assert.ok(
    activity.some(
      (a) =>
        a.kind === "complete" &&
        /verification and review remain/.test(a.summary),
    ),
  );
  assert.equal(
    f.store.get("stage", f.service.getTicket(ticket.id).stageId).role,
    "planning",
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
  assert.ok(call.args[2].includes(description));
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
  assert.equal(env.AGENT_DESK_TOKEN, "scoped-fixture-token");
});
