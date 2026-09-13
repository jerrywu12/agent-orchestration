import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Store } from "../server/store.mjs";
import { Service } from "../server/service.mjs";
import { createManagedBridge } from "../server/managed-bridge.mjs";
import { managedRequest } from "../bin/managed-client.mjs";

const client = fileURLToPath(
  new URL("../bin/managed-client.mjs", import.meta.url),
);
function fixture(t, options = {}) {
  const worktree = mkdtempSync(join(tmpdir(), "desk-mailbox-"));
  const store = new Store(":memory:");
  const service = new Service(store);
  const project = service.createProject({ name: "Mailbox fixture" });
  const ticket = service.createTicket({
    projectId: project.id,
    title: "Claimed mailbox work",
    ownerId: "codex",
    stageId: store.list("stage", project.id).find((s) => s.role === "ready").id,
  });
  const execution = service.claim(ticket.id, {
    agentId: "codex",
    sessionId: "managed-fixture",
  });
  const bridge = createManagedBridge({
    service,
    execution,
    worktree,
    ...options,
  });
  t.after(async () => {
    await bridge.flush();
    bridge.close();
    store.close();
    rmSync(worktree, { recursive: true, force: true });
  });
  const request = (operation, input = {}) =>
    managedRequest(bridge.directory, operation, input, { timeoutMs: 2000 });
  const cli = (operation, input = {}) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [client, operation, JSON.stringify(input)],
        {
          cwd: worktree,
          env: {
            PATH: process.env.PATH,
            AGENT_DESK_BRIDGE_DIR: bridge.directory,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let out = "",
        err = "";
      child.stdout.on("data", (b) => (out += b));
      child.stderr.on("data", (b) => (err += b));
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, out, err }));
    });
  return { worktree, store, service, ticket, execution, bridge, request, cli };
}

test("actual CLI reads its ticket, updates a blocker and explicitly checkpoints without credentials or network", async (t) => {
  const f = fixture(t);
  assert.equal(
    readFileSync(join(f.bridge.directory, ".gitignore"), "utf8"),
    "*\n",
  );
  assert.equal((await f.cli("get_task")).code, 0);
  assert.ok(f.store.execution(f.execution.id).reportingReadyAt);
  const current = f.service.getTicket(f.ticket.id);
  const updated = await f.cli("update_task", {
    version: current.version,
    reason: "Fixture verified dependency is unavailable",
    changes: { blockedReason: "Waiting for dependency owner" },
  });
  assert.equal(updated.code, 0, updated.err);
  assert.equal(
    f.service.getTicket(f.ticket.id).blockedReason,
    "Waiting for dependency owner",
  );
  const checkpoint = await f.cli("report_progress", {
    type: "checkpoint",
    summary: "Saved fixture state; dependency handoff required",
  });
  assert.equal(checkpoint.code, 0, checkpoint.err);
  assert.equal(f.store.execution(f.execution.id).state, "checkpointed");
  assert.ok(f.store.execution(f.execution.id).releasedAt);
});

test("handshake and exact identity restrictions reject foreign inputs without poisoning the queue", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    f.request("report_progress", { type: "progress", summary: "premature" }),
    { code: "REPORTING_HANDSHAKE" },
  );
  await assert.rejects(f.request("get_task", { ticketId: "foreign" }), {
    code: "BRIDGE_FIELDS",
  });
  await assert.rejects(f.request("claim_task"), { code: "BRIDGE_OPERATION" });
  const own = await f.request("get_task");
  assert.equal(own.id, f.ticket.id);
  await assert.rejects(
    f.request("update_task", {
      version: own.version,
      reason: "reject reassignment",
      changes: { ownerId: "claude" },
    }),
    { code: "AGENT_FIELDS" },
  );
  assert.equal(
    (await f.request("get_resolution_context")).ticket.id,
    f.ticket.id,
  );
  const child = await f.request("create_subtask", {
    reason: "separate followup",
    title: "Fixture followup",
  });
  assert.equal(child.ownerId, "codex");
  assert.equal(child.parentId, f.ticket.id);
  assert.equal(f.store.active(child.id), null);
});

test("report replay retains one sequence and explicit terminal result; released executions reject new requests", async (t) => {
  const f = fixture(t);
  await f.request("get_task");
  const input = {
    type: "complete",
    summary: "Acceptance evidence saved for independent review",
    eventId: randomUUID(),
  };
  const first = await f.request("report_progress", input);
  const replay = await f.request("report_progress", input);
  assert.equal(replay.lastSeq, first.lastSeq);
  assert.equal(f.store.execution(f.execution.id).state, "awaiting_review");
  await assert.rejects(
    f.request("report_progress", { ...input, summary: "changed replay" }),
    { code: "EVENT_CONFLICT" },
  );
  await assert.rejects(f.request("get_task"), { code: "SESSION_MISMATCH" });
});

test("a failed parent reporter leaves later reporting usable and preserves scoped event fields", async (t) => {
  let calls = 0;
  const seen = [];
  const f = fixture(t, {
    sendEvent(type, summary, extra) {
      if (++calls === 1) throw Error("injected parent failure");
      seen.push({ type, summary, extra });
    },
  });
  await f.request("get_task");
  await assert.rejects(
    f.request("report_progress", { type: "progress", summary: "first" }),
    { code: "BRIDGE_ERROR" },
  );
  await f.request("report_progress", {
    type: "progress",
    summary: "second",
    progress: 25,
  });
  assert.equal(seen[0].extra.progress, 25);
  assert.equal(seen[0].type, "progress");
  assert.ok(seen[0].extra.eventId);
});

test("symlink requests cannot read outside the mailbox and malformed or oversized input cannot block valid work", async (t) => {
  const f = fixture(t);
  const secret = join(f.worktree, "private-fixture.txt");
  writeFileSync(secret, "do-not-return-this-fixture");
  const requestId = randomUUID();
  symlinkSync(secret, join(f.bridge.directory, `${requestId}.request.json`));
  writeFileSync(join(f.bridge.directory, `${randomUUID()}.request.json`), "{");
  writeFileSync(
    join(f.bridge.directory, `${randomUUID()}.request.json`),
    "x".repeat(65537),
  );
  await f.bridge.flush();
  const result = readFileSync(
    join(f.bridge.directory, `${requestId}.response.json`),
    "utf8",
  );
  assert.doesNotMatch(result, /do-not-return-this-fixture/);
  assert.equal(JSON.parse(result).error.code, "BRIDGE_FILE");
  assert.equal((await f.request("get_task")).id, f.ticket.id);
});

test("client rejects a symlink mailbox and observes close without a network fallback", async (t) => {
  const f = fixture(t);
  const alias = join(f.worktree, "mailbox-alias");
  symlinkSync(f.bridge.directory, alias);
  await assert.rejects(managedRequest(alias, "get_task"), {
    code: "BRIDGE_FILE",
  });
  f.bridge.close();
  await assert.rejects(f.request("get_task"), { code: "BRIDGE_CLOSED" });
});

test("replacing the mailbox with a symlink cannot redirect the parent", async (t) => {
  const f = fixture(t);
  const outside = join(f.worktree, "outside");
  mkdirSync(outside);
  renameSync(f.bridge.directory, f.bridge.directory + "-original");
  symlinkSync(outside, f.bridge.directory);
  const id = randomUUID();
  writeFileSync(
    join(outside, `${id}.request.json`),
    JSON.stringify({ id, operation: "get_task", input: {} }),
  );
  await f.bridge.flush();
  assert.equal(existsSync(join(outside, `${id}.response.json`)), false);
  assert.equal(f.store.execution(f.execution.id).reportingReadyAt, undefined);
});
