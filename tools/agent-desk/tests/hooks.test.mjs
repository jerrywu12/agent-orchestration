import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "desk-hooks-"));
  const root = join(dir, "project with spaces");
  const bin = join(dir, "bin");
  const worktree = join(dir, "isolated worktree");
  const log = join(dir, "events.jsonl");
  for (const path of [
    join(root, "scripts"),
    join(root, "specs"),
    bin,
    join(worktree, "scripts"),
  ])
    mkdirSync(path, { recursive: true });
  for (const name of [
    "codex_auto_dev.sh",
    "agent_workflow.sh",
    "agent_desk_hook.sh",
  ]) {
    const source = join(sourceRoot, "scripts", name);
    if (existsSync(source)) {
      copyFileSync(source, join(root, "scripts", name));
      chmodSync(join(root, "scripts", name), 0o700);
    }
  }
  const nodeScript = (path, body) =>
    writeFileSync(path, `#!${process.execPath}\n${body}\n`, { mode: 0o700 });
  const record = `const fs=require('node:fs');const record=x=>fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(x)+'\\n');`;
  nodeScript(
    join(bin, "agent-desk"),
    `${record}\nconst {spawnSync}=require('node:child_process');const args=process.argv.slice(2);const option=k=>args[args.indexOf(k)+1];record({type:'wrap',args,wrapped:process.env.AGENT_DESK_WRAPPED??'',fixtureTokenRetained:process.env.AGENT_DESK_TOKEN==='fixture-explicit-token'});if(process.env.FAKE_WRAP_DENY==='1')process.exit(23);const ticket=option('--ticket');const agent=option('--agent');const i=args.indexOf('--');const result=spawnSync(args[i+1],args.slice(i+2),{stdio:'inherit',env:{...process.env,AGENT_DESK_TICKET_ID:ticket,AGENT_DESK_AGENT_ID:agent,AGENT_DESK_WRAPPED:'1',AGENT_DESK_EXECUTION_ID:'fake-execution',AGENT_DESK_SESSION_ID:'fake-session'}});process.exit(result.status??1);`,
  );
  nodeScript(
    join(root, "scripts", "agent_worktree.sh"),
    `${record}\nconst args=process.argv.slice(2);if(args[0]==='create')record({type:'worktree',args});else if(args[0]==='path')console.log(${JSON.stringify(worktree)});`,
  );
  nodeScript(
    join(worktree, "scripts", "dev_check.sh"),
    `${record}\nrecord({type:'gate',args:process.argv.slice(2)});`,
  );
  nodeScript(
    join(worktree, "scripts", "spec_coverage_verify.sh"),
    "process.exit(0);",
  );
  nodeScript(
    join(root, "scripts", "gemini_auto_review.sh"),
    `${record}\nrecord({type:'review',args:process.argv.slice(2),ticket:process.env.AGENT_DESK_TICKET_ID??'',agent:process.env.AGENT_DESK_AGENT_ID??'',wrapped:process.env.AGENT_DESK_WRAPPED??''});`,
  );
  const spec = join(root, "specs", "Feature with spaces_DEV_PLAN.md");
  writeFileSync(spec, "Fixture only.\n");
  const env = {
    ...process.env,
    PATH: `${bin}:/usr/bin:/bin`,
    CODEX_CMD: "fixture-no-real-model-installed",
    AGENT_AUTO_PR: "0",
    AGENT_DESK_TICKET_ID: "",
    AGENT_DESK_WRAPPED: "",
    AGENT_DESK_AGENT_ID: "",
    AGENT_DESK_EXECUTION_ID: "",
    AGENT_DESK_SESSION_ID: "",
    AGENT_DESK_TOKEN: "",
    TMPDIR: dir,
  };
  const run = (script, args = [], extra = {}) =>
    spawnSync("/bin/bash", [join(root, "scripts", script), ...args], {
      cwd: root,
      env: { ...env, ...extra },
      encoding: "utf8",
      timeout: 10000,
    });
  const events = () =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map(JSON.parse)
      : [];
  const job = join(
    root,
    "storage",
    "agent_queue",
    "pending",
    `${spec.split("/").at(-1)}.job`,
  );
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, root, bin, spec, run, events, job };
}

test("linked Codex wraps once before worktree work and preserves exact command arguments", (t) => {
  const f = fixture(t);
  const result = f.run("codex_auto_dev.sh", [f.spec], {
    AGENT_DESK_TICKET_ID: "ticket-123",
  });
  assert.equal(result.status, 0, result.stderr);
  const events = f.events();
  assert.equal(events[0]?.type, "wrap");
  assert.equal(events.filter((x) => x.type === "wrap").length, 1);
  assert.deepEqual(events[0].args, [
    "wrap",
    "--ticket",
    "ticket-123",
    "--agent",
    "codex",
    "--",
    join(f.root, "scripts", "codex_auto_dev.sh"),
    f.spec,
  ]);
  assert.ok(events.some((x) => x.type === "worktree"));
});

test("an assigned ticket fails closed before worktree edits when CLI or claim is unavailable", (t) => {
  const f = fixture(t);
  let result = f.run("codex_auto_dev.sh", [f.spec], {
    AGENT_DESK_TICKET_ID: "ticket-123",
    FAKE_WRAP_DENY: "1",
  });
  assert.equal(result.status, 23);
  assert.equal(
    f.events().some((x) => x.type === "worktree"),
    false,
  );
  rmSync(join(f.bin, "agent-desk"));
  result = f.run("codex_auto_dev.sh", [f.spec], {
    AGENT_DESK_TICKET_ID: "ticket-123",
  });
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /agent-desk.*unavailable|unavailable.*agent-desk/i,
  );
  assert.equal(
    f.events().some((x) => x.type === "worktree"),
    false,
  );
});

test("unlinked Codex keeps existing placeholder behavior with a truthful board notice", (t) => {
  const f = fixture(t);
  const result = f.run("codex_auto_dev.sh", [f.spec]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout + result.stderr, /unlinked/i);
  assert.equal(
    f.events().some((x) => x.type === "wrap"),
    false,
  );
  assert.ok(f.events().some((x) => x.type === "gate"));
});

test("queue persists explicit ticket metadata and forwards it without inheriting another ticket", (t) => {
  const f = fixture(t);
  const submit = f.run("agent_workflow.sh", [
    "handoff",
    "submit",
    f.spec,
    "--ticket",
    "queue-ticket",
    "--agent",
    "codex",
  ]);
  assert.equal(submit.status, 0, submit.stderr);
  assert.match(readFileSync(f.job, "utf8"), /^ticket_id="queue-ticket"$/m);
  assert.equal(f.events().length, 0);
  const run = f.run("agent_workflow.sh", ["handoff", "run-next"], {
    AGENT_DESK_TICKET_ID: "parent-ticket",
    AGENT_DESK_AGENT_ID: "claude",
    AGENT_DESK_WRAPPED: "1",
    AGENT_DESK_EXECUTION_ID: "parent-run",
    AGENT_DESK_SESSION_ID: "parent-session",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(f.events().filter((x) => x.type === "wrap").length, 1);
  assert.equal(
    f.events().find((x) => x.type === "wrap").args[2],
    "queue-ticket",
  );
  assert.match(readFileSync(f.job, "utf8"), /status="completed"/);
});

test("queue wraps Gemini with explicit agent and reuses an exact inherited execution", (t) => {
  const f = fixture(t);
  let result = f.run("agent_workflow.sh", [
    "handoff",
    "submit",
    f.spec,
    "--ticket",
    "review-ticket",
    "--agent",
    "gemini",
  ]);
  assert.equal(result.status, 0, result.stderr);
  result = f.run("agent_workflow.sh", ["handoff", "run-next"]);
  assert.equal(result.status, 0, result.stderr);
  const wrap = f.events().find((x) => x.type === "wrap");
  assert.ok(wrap);
  assert.deepEqual(wrap.args.slice(0, 6), [
    "wrap",
    "--ticket",
    "review-ticket",
    "--agent",
    "gemini",
    "--",
  ]);
  assert.deepEqual(
    f.events().find((x) => x.type === "review"),
    {
      type: "review",
      args: ["feature-with-spaces"],
      ticket: "review-ticket",
      agent: "gemini",
      wrapped: "1",
    },
  );
  result = f.run("agent_workflow.sh", [
    "handoff",
    "submit",
    f.spec,
    "--ticket",
    "review-ticket",
    "--agent",
    "gemini",
  ]);
  assert.equal(result.status, 0);
  result = f.run("agent_workflow.sh", ["handoff", "run-next"], {
    AGENT_DESK_TICKET_ID: "review-ticket",
    AGENT_DESK_AGENT_ID: "gemini",
    AGENT_DESK_WRAPPED: "1",
    AGENT_DESK_EXECUTION_ID: "existing-run",
    AGENT_DESK_SESSION_ID: "existing-session",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.events().filter((x) => x.type === "wrap").length, 1);
  assert.equal(f.events().filter((x) => x.type === "review").length, 2);
});

test("unlinked queue metadata clears unrelated inherited claims and invalid ticket IDs never dispatch", (t) => {
  const f = fixture(t);
  let result = f.run("agent_workflow.sh", ["handoff", "submit", f.spec]);
  assert.equal(result.status, 0, result.stderr);
  result = f.run("agent_workflow.sh", ["handoff", "run-next"], {
    AGENT_DESK_TICKET_ID: "parent-ticket",
    AGENT_DESK_AGENT_ID: "codex",
    AGENT_DESK_WRAPPED: "1",
    AGENT_DESK_EXECUTION_ID: "parent-run",
    AGENT_DESK_SESSION_ID: "parent-session",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    f.events().some((x) => x.type === "wrap"),
    false,
  );
  assert.match(result.stdout + result.stderr, /unlinked/i);
  const marker = join(f.dir, "shell-executed");
  const bad = `ticket;touch ${marker}`;
  result = f.run("agent_workflow.sh", [
    "handoff",
    "submit",
    f.spec,
    "--ticket",
    bad,
  ]);
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(marker), false);
  writeFileSync(
    f.job,
    `spec_path="${f.spec}"\ntarget_agent="codex"\nmode="local-worktree"\nticket_id="${bad}"\nstatus="pending"\n`,
  );
  const before = f.events().length;
  result = f.run("agent_workflow.sh", ["handoff", "run-next"]);
  assert.notEqual(result.status, 0);
  assert.equal(f.events().length, before);
  assert.equal(existsSync(marker), false);
});

test("explicit caller credentials survive while credentials from a different inherited agent are cleared", (t) => {
  const f = fixture(t);
  for (const [ticket, agent] of [
    ["new-review", ""],
    ["other-review", "codex"],
  ]) {
    const submit = f.run("agent_workflow.sh", [
      "handoff",
      "submit",
      f.spec,
      "--ticket",
      ticket,
      "--agent",
      "gemini",
    ]);
    assert.equal(submit.status, 0);
    const run = f.run("agent_workflow.sh", ["handoff", "run-next"], {
      AGENT_DESK_TOKEN: "fixture-explicit-token",
      AGENT_DESK_AGENT_ID: agent,
    });
    assert.equal(run.status, 0, run.stderr);
  }
  assert.deepEqual(
    f
      .events()
      .filter((x) => x.type === "wrap")
      .map((x) => x.fixtureTokenRetained),
    [true, false],
  );
});
