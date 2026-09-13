import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  captureProcessIdentity,
  traceExecution,
} from "../server/session-trace.mjs";

const nativeId = "019c6e27-e55b-73d1-87d8-4e01f1f75043";
const otherId = "019c7714-3b77-74d1-9866-e1f484aae2ab";
const identity = {
  pid: 4321,
  platform: "darwin",
  command: "/fixture/codex",
  startedAt: "Sun Sep 13 10:40:05 2026",
};
const run = { id: "execution-fixture", sessionId: "desk-fixture" };

function fixture(t, rows = []) {
  const codexHome = mkdtempSync(join(tmpdir(), "desk-trace-"));
  const db = new DatabaseSync(join(codexHome, "state_5.sqlite"));
  // No transcript/title columns: the trace must need only these two fields.
  db.exec("CREATE TABLE threads(id TEXT PRIMARY KEY, cwd TEXT)");
  for (const row of rows)
    db.prepare("INSERT INTO threads(id,cwd) VALUES(?,?)").run(row.id, row.cwd);
  db.close();
  t.after(() => rmSync(codexHome, { recursive: true, force: true }));
  return {
    codexHome,
    probe: async () => {
      throw Error("Tests must explicitly inject any process observation");
    },
  };
}

test("an exact live runner child proves managed background execution", async (t) => {
  const result = await traceExecution(run, {
    ...fixture(t),
    children: new Map([
      [run.id, { pid: 4321, exitCode: null, signalCode: null }],
    ]),
  });
  assert.equal(result.tracking, "managed");
  assert.equal(result.processAlive, true);
  assert.equal(result.nativeThreadUrl, null);
  assert.match(result.reason, /background/i);
});

test("an unrelated child and a bare reused PID never prove the claimed process", async (t) => {
  const options = {
    ...fixture(t),
    children: new Map([
      ["another-execution", { pid: 4321, exitCode: null, signalCode: null }],
    ]),
    probe: async () => ({ alive: true, identity }),
  };
  const bare = await traceExecution({ ...run, pid: 4321 }, options);
  assert.equal(bare.tracking, "untraceable");
  assert.equal(bare.processAlive, null);
  const reused = await traceExecution(
    { ...run, pid: 4321, processIdentity: identity },
    {
      ...options,
      probe: async () => ({
        alive: true,
        identity: { ...identity, startedAt: "Sun Sep 13 10:41:00 2026" },
      }),
    },
  );
  assert.equal(reused.tracking, "untraceable");
  assert.equal(reused.processAlive, false);
  assert.match(reused.evidence.join(" "), /different|reused|identity/i);
});

test("matching persisted identity proves a process after the supervisor restarted", async (t) => {
  const result = await traceExecution(
    { ...run, pid: 4321, processIdentity: identity, external: true },
    { ...fixture(t), probe: async () => ({ alive: true, identity }) },
  );
  assert.equal(result.tracking, "process");
  assert.equal(result.processAlive, true);
  assert.match(result.evidence.join(" "), /identity|fingerprint/);
});

test("exec replacing a launcher command preserves the live process birth identity", async (t) => {
  const result = await traceExecution(
    {
      ...run,
      pid: 4321,
      processIdentity: { ...identity, command: "/fixture/launcher" },
      external: true,
    },
    { ...fixture(t), probe: async () => ({ alive: true, identity }) },
  );
  assert.equal(result.tracking, "process");
  assert.equal(result.processAlive, true);
  assert.match(result.evidence.join(" "), /command (changed|differs)/i);
  assert.doesNotMatch(result.evidence.join(" "), /PID reuse/i);
});

test("process permission failures and missing fingerprints remain unknown", async (t) => {
  const options = fixture(t);
  for (const probe of [
    async () => ({ alive: null, identity: null, reason: "unavailable" }),
    async () => ({ alive: true, identity: null }),
    async () => {
      throw Error("credential-sentinel must never be returned");
    },
  ]) {
    const result = await traceExecution(
      { ...run, pid: 4321, processIdentity: identity },
      { ...options, probe },
    );
    assert.equal(result.processAlive, null);
    assert.equal(result.tracking, "untraceable");
    assert.doesNotMatch(JSON.stringify(result), /credential-sentinel/);
  }
});

test("an absent recorded process is distinguished from an unavailable native source", async (t) => {
  const result = await traceExecution(
    { ...run, pid: 4321, processIdentity: identity, sessionId: nativeId },
    {
      ...fixture(t),
      probe: async () => ({ alive: false, identity: null }),
    },
  );
  assert.equal(result.processAlive, false);
  assert.equal(result.nativeThreadUrl, null);
  assert.equal(result.tracking, "untraceable");
});

test("only a trusted runner native ID or exact registry record produces a native link", async (t) => {
  const options = fixture(t);
  const confirmed = await traceExecution(
    {
      ...run,
      managedBy: "agent-desk",
      nativeSessionId: nativeId,
      nativeSessionSource: "runner",
    },
    options,
  );
  assert.equal(confirmed.nativeThreadUrl, `codex://threads/${nativeId}`);
  assert.equal(confirmed.tracking, "recorded");
  assert.equal(confirmed.processAlive, null);
  for (const unconfirmed of [
    { ...run, sessionId: nativeId, external: true },
    { ...run, nativeSessionId: nativeId },
    { ...run, nativeSessionId: "not-a-uuid", nativeSessionSource: "runner" },
  ]) {
    const result = await traceExecution(unconfirmed, options);
    assert.equal(result.nativeThreadUrl, null);
    assert.equal(result.nativeSessionId, null);
    assert.equal(result.processAlive, null);
  }
});

test("matching an imported session against registry metadata proves a record, never liveness", async (t) => {
  const result = await traceExecution(
    { ...run, sessionId: nativeId, external: true },
    fixture(t, [{ id: nativeId, cwd: "/fixture/shared-project" }]),
  );
  assert.equal(result.tracking, "recorded");
  assert.equal(result.nativeSessionId, nativeId);
  assert.equal(result.nativeThreadUrl, `codex://threads/${nativeId}`);
  assert.equal(result.processAlive, null);
  assert.match(result.reason, /unverified|unknown/);
});

test("exact unique managed worktree locates native record without title guesses", async (t) => {
  const worktreePath = `/fixture/worktrees/${run.id}`;
  const options = fixture(t, [{ id: nativeId, cwd: worktreePath }]);
  const result = await traceExecution(
    { ...run, managedBy: "agent-desk", worktreePath },
    options,
  );
  assert.equal(result.nativeSessionId, nativeId);
  const imported = await traceExecution({ ...run, worktreePath }, options);
  assert.equal(imported.nativeSessionId, null);
});

test("ambiguous exact worktree and conflicting native identifiers cannot choose a task", async (t) => {
  const worktreePath = `/fixture/worktrees/${run.id}`;
  const options = fixture(t, [
    { id: nativeId, cwd: worktreePath },
    { id: otherId, cwd: worktreePath },
  ]);
  for (const execution of [
    { ...run, managedBy: "agent-desk", worktreePath },
    { ...run, sessionId: nativeId, nativeSessionId: otherId },
  ]) {
    const result = await traceExecution(execution, options);
    assert.equal(result.nativeThreadUrl, null);
    assert.equal(result.processAlive, null);
    assert.match(result.evidence.join(" "), /ambiguous|multiple/);
  }
});

test("missing or corrupt native registry does not clear a stale imported claim", async (t) => {
  const options = fixture(t);
  rmSync(join(options.codexHome, "state_5.sqlite"));
  for (const corrupt of [false, true]) {
    if (corrupt)
      writeFileSync(
        join(options.codexHome, "state_5.sqlite"),
        "not a database",
      );
    const result = await traceExecution(
      { ...run, sessionId: nativeId, state: "working", external: true },
      options,
    );
    assert.equal(result.tracking, "untraceable");
    assert.equal(result.processAlive, null);
    assert.match(result.evidence.join(" "), /unavailable|missing|not found/);
  }
});

test("legacy claims need no native scan and snapshots never include file bodies", async (t) => {
  const options = fixture(t);
  mkdirSync(join(options.codexHome, "sessions"));
  writeFileSync(
    join(options.codexHome, "sessions", `rollout-${nativeId}.jsonl`),
    "private-prompt-secret-sentinel",
  );
  const result = await traceExecution(
    { ...run, sessionId: "legacy-free-form-import", external: true },
    options,
  );
  assert.equal(result.tracking, "untraceable");
  assert.equal(result.processAlive, null);
  assert.equal(result.nativeThreadUrl, null);
  assert.doesNotMatch(JSON.stringify(result), /private-prompt-secret-sentinel/);
});

test("capture accepts only complete exact-PID fingerprints and never returns probe errors", async () => {
  assert.deepEqual(
    await captureProcessIdentity(4321, {
      probe: async () => ({ alive: true, identity }),
    }),
    identity,
  );
  for (const value of [
    { alive: false, identity },
    { alive: true, identity: { ...identity, pid: 5 } },
    { alive: true, identity: { pid: 4321 } },
  ])
    assert.equal(
      await captureProcessIdentity(4321, { probe: async () => value }),
      null,
    );
});

test("native capture of a synthetic child yields a stable fingerprint or explicit unknown", async (t) => {
  if (!["darwin", "linux"].includes(process.platform)) return t.skip();
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
  });
  await once(child, "spawn");
  const processIdentity = await captureProcessIdentity(child.pid);
  if (processIdentity) {
    assert.equal(processIdentity.pid, child.pid);
    assert.equal(processIdentity.platform, process.platform);
  }
  const options = fixture(t);
  const { probe, ...nativeOptions } = options;
  const result = await traceExecution(
    { ...run, pid: child.pid, processIdentity },
    nativeOptions,
  );
  // Restricted macOS test runners may deny ps even for their own child. The
  // production contract in that environment is explicit unknown, never stopped.
  assert.equal(result.tracking, processIdentity ? "process" : "untraceable");
  assert.equal(result.processAlive, processIdentity ? true : null);
});

test("unresponsive injected process sources meet the observation deadline", async (t) => {
  const started = Date.now();
  const result = await traceExecution(
    { ...run, pid: 4321, processIdentity: identity },
    { ...fixture(t), probe: () => new Promise(() => {}) },
  );
  assert.equal(result.processAlive, null);
  assert.ok(Date.now() - started < 2500);
});

test("a missing or incompatible registry remains explicitly unavailable", async (t) => {
  const options = fixture(t);
  const missing = await traceExecution(
    { ...run, sessionId: nativeId },
    { ...options, codexHome: join(options.codexHome, "missing") },
  );
  assert.equal(missing.processAlive, null);
  assert.match(missing.evidence.join(" "), /unavailable/);
  const db = new DatabaseSync(join(options.codexHome, "state_6.sqlite"));
  db.exec("CREATE TABLE renamed_registry(id TEXT PRIMARY KEY)");
  db.close();
  const incompatible = await traceExecution(
    { ...run, sessionId: nativeId },
    options,
  );
  assert.equal(incompatible.nativeSessionId, null);
  assert.equal(incompatible.processAlive, null);
  assert.match(incompatible.evidence.join(" "), /unavailable/);
});
