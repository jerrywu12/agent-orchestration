import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { AppError, Store } from "../server/store.mjs";
import { Service } from "../server/service.mjs";
import { Runner } from "../server/runner.mjs";
import { RunCoordinator } from "../server/run-coordinator.mjs";

function fixture(t, { actualRunner = false } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "desk-admission-")));
  const repo = join(dir, "source");
  mkdirSync(repo);
  const store = new Store(":memory:");
  const service = new Service(store);
  const project = service.createProject({
    name: "Admission fixture",
    path: repo,
  });
  const stage = (role) =>
    store.list("stage", project.id).find((s) => s.role === role).id;
  let originalPath;
  let runner;
  if (actualRunner) {
    const bin = join(dir, "bin"),
      hooks = join(dir, "empty-hooks");
    mkdirSync(bin);
    mkdirSync(hooks);
    const git = (...args) =>
      execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
    git("init", "--initial-branch=main");
    git("config", "core.hooksPath", hooks);
    git("config", "user.name", "Admission fixture");
    git("config", "user.email", "admission@example.invalid");
    writeFileSync(join(repo, "README.md"), "Synthetic committed fixture\n");
    git("add", "README.md");
    git(
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--no-gpg-sign",
      "-m",
      "Fixture",
    );
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    // Every executable the real Runner might select is a local synthetic process.
    for (const name of ["codex", "claude", "gemini", "agent"])
      writeFileSync(
        join(bin, name),
        `#!${process.execPath}\nsetInterval(() => {}, 1000);\n`,
        { mode: 0o700 },
      );
    originalPath = process.env.PATH;
    process.env.PATH = bin + delimiter + originalPath;
    runner = new Runner(service, {
      dataDir: join(dir, "data"),
      url: "http://127.0.0.1:1",
    });
  } else {
    runner = {
      children: new Map(),
      availability: () =>
        store
          .list("agent")
          .map((a) => ({ id: a.id, available: a.adapter !== "external" })),
      start(key, { automatic = false } = {}) {
        const ticket = service.require("ticket", key);
        const execution = service.claim(
          key,
          {
            agentId: ticket.ownerId,
            sessionId: randomUUID(),
          },
          { resolveBlockers: !automatic && service.resolutionNeeded(ticket) },
        );
        runner.children.set(execution.id, { synthetic: true });
        return execution;
      },
    };
    service.runner = runner;
    runner.coordinator = new RunCoordinator(service, runner);
  }
  const coord = runner.coordinator;
  const ticket = (extra = {}) =>
    service.createTicket({
      projectId: project.id,
      title: "Independent fixture ticket",
      ownerId: "codex",
      stageId: stage("ready"),
      brief: {
        specification: "Synthetic specification",
        acceptanceCriteria: "Observe scoped admission",
        scope: "Independent fixture work",
        verification: "Run dispatch admission tests",
        allowedPaths: `fixtures/${randomUUID()}/**`,
        conflictKeys: "none",
      },
      ...extra,
    });
  const claim = (target, { managed = false, stale = false } = {}) => {
    const execution = service.claim(target.id, {
      agentId: target.ownerId,
      sessionId: randomUUID(),
      external: !managed,
    });
    if (managed) runner.children.set(execution.id, { synthetic: true });
    return stale
      ? store.saveExecution({
          ...execution,
          heartbeatAt: "2001-01-01T00:00:00.000Z",
        })
      : execution;
  };
  const finish = (execution, { close = true } = {}) => {
    const current = store.execution(execution.id);
    const result = service.event(current.id, {
      agentId: current.agentId,
      sessionId: current.sessionId,
      eventId: randomUUID(),
      seq: current.lastSeq + 1,
      type: "checkpoint",
      summary: "Synthetic execution saved its state",
    });
    if (close) runner.children.delete(current.id);
    return result;
  };
  const submit = (tickets, concurrency = 2) =>
    coord.submit({
      ticketIds: tickets.map((item) => item.id),
      concurrency,
      requestId: randomUUID(),
    });
  const confirm = (target) =>
    service.transition(target.id, {
      version: service.require("ticket", target.id).version,
      ownerId: target.ownerId,
      stageId: stage("planning"),
      confirmed: true,
    });
  t.after(async () => {
    coord.close();
    await Promise.all(
      [...runner.children.values()]
        .filter((child) => typeof child.kill === "function")
        .map(
          (child) =>
            new Promise((resolve) => {
              if (child.exitCode !== null || child.signalCode !== null)
                return resolve();
              child.once("close", resolve);
              child.kill("SIGTERM");
            }),
        ),
    );
    runner.children.clear();
    if (originalPath !== undefined) process.env.PATH = originalPath;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    dir,
    repo,
    store,
    service,
    project,
    runner,
    coord,
    stage,
    ticket,
    claim,
    finish,
    submit,
    confirm,
  };
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail(message);
}

test("two independent tickets assigned to the same provider use two supervised slots", (t) => {
  const f = fixture(t),
    a = f.ticket(),
    b = f.ticket();
  const batch = f.submit([a, b], 2);
  f.coord.drain();
  assert.deepEqual(
    f.coord.get(batch.id).results.map((row) => row.status),
    ["running", "running"],
  );
  assert.equal(f.runner.children.size, 2);
  assert.notEqual(f.store.active(a.id).id, f.store.active(b.id).id);
});

test("unrelated stale provider ownership cannot starve an independent ticket", (t) => {
  const f = fixture(t),
    held = f.ticket(),
    target = f.ticket();
  const old = f.claim(held, { stale: true });
  const batch = f.submit([target], 2);
  f.coord.drain();
  assert.equal(f.coord.get(batch.id).results[0].status, "running");
  assert.equal(f.runner.children.size, 1);
  assert.equal(f.store.active(held.id).id, old.id);
  assert.equal(f.store.execution(old.id).releasedAt, null);
  assert.equal(f.store.execution(old.id).lastSeq, old.lastSeq);
});

test("the exact stale target claim remains reserved and requires takeover", (t) => {
  const f = fixture(t),
    target = f.ticket();
  const old = f.claim(target, { stale: true });
  const batch = f.submit([target], 2);
  f.coord.drain();
  const row = f.coord.get(batch.id).results[0];
  assert.equal(row.status, "needs_takeover");
  assert.equal(row.executionId, old.id);
  assert.equal(f.store.active(target.id).id, old.id);
  assert.equal(f.runner.children.size, 0);
});

for (const setup of [
  "default ceiling",
  "smallest outstanding batch",
  "terminal child still open",
]) {
  test(`real Runner direct start honors ${setup}`, (t) => {
    const f = fixture(t, { actualRunner: true });
    const limit = setup === "default ceiling" ? 4 : 1;
    for (let i = 0; i < limit; i++) {
      const occupied = f.claim(
        f.ticket({ ownerId: "claude", stageId: f.stage("planning") }),
        { managed: true },
      );
      if (setup === "terminal child still open")
        f.finish(occupied, { close: false });
    }
    if (limit === 1) f.submit([f.ticket({ ownerId: "gemini" })], 1);
    const target = f.ticket();
    try {
      f.runner.start(target.id);
    } catch (error) {
      assert.equal(error.status, 409);
      assert.match(error.message, /capacity|slot|limit/i);
    }
    assert.equal(
      f.runner.children.size,
      limit,
      "a direct call cannot create a child beyond the global ceiling",
    );
    assert.equal(
      f.store.active(target.id),
      null,
      "capacity waits must precede claiming the target",
    );
  });
}

test("confirmed transition waits at the smallest outstanding batch ceiling", (t) => {
  const f = fixture(t);
  f.claim(f.ticket({ ownerId: "claude", stageId: f.stage("planning") }), {
    managed: true,
  });
  f.submit([f.ticket({ ownerId: "gemini" })], 1);
  const target = f.ticket({ stageId: f.stage("planning") });
  assert.equal(f.confirm(target).outcome, "queued");
  assert.equal(f.runner.children.size, 1);
  assert.equal(f.store.active(target.id), null);
  assert.equal(f.store.get("launch-intent", target.id).status, "queued");
});

test("changed confirmed payload is invalidated while every managed slot is occupied", (t) => {
  const f = fixture(t);
  const occupied = f.claim(f.ticket({ stageId: f.stage("planning") }), {
    managed: true,
  });
  f.submit([f.ticket({ ownerId: "gemini" })], 1);
  const target = f.ticket({ stageId: f.stage("planning") });
  assert.equal(f.confirm(target).outcome, "queued");
  const current = f.service.require("ticket", target.id);
  f.service.updateTicket(target.id, {
    version: current.version,
    title: "Changed after confirmation",
  });
  const outcome = f.service.dispatchIntent(target.id);
  assert.equal(outcome.outcome, "failed");
  assert.match(outcome.reason, /changed|confirm again/i);
  assert.equal(f.store.get("launch-intent", target.id).status, "failed");
  assert.equal(f.store.active(target.id), null);
  assert.equal(f.store.active(occupied.ticketId).id, occupied.id);
});

for (const completedBeforeDrain of [false, true]) {
  test(`a separate exact claim binds queued confirmation and batch, completion before drain=${completedBeforeDrain}`, (t) => {
    const f = fixture(t);
    const occupied = f.claim(f.ticket({ stageId: f.stage("planning") }), {
      managed: true,
    });
    const target = f.ticket({ stageId: f.stage("planning") });
    const batch = f.submit([target], 1);
    assert.equal(f.confirm(target).outcome, "queued");
    const claimed = f.claim(target);
    if (completedBeforeDrain) f.finish(claimed);
    f.finish(occupied);
    f.coord.drain();
    const executions = f.store.db
      .prepare("SELECT COUNT(*) AS count FROM executions WHERE ticket_id=?")
      .get(target.id).count;
    assert.equal(
      executions,
      1,
      "the old authorization must not launch a replacement execution",
    );
    assert.equal(
      f.store.get("launch-intent", target.id).executionId,
      claimed.id,
    );
    const row = f.coord.get(batch.id).results[0];
    assert.equal(row.executionId, claimed.id);
    if (completedBeforeDrain) assert.equal(row.status, "checkpointed");
  });
}

test("a queued batch alone follows a claim that checkpoints before the first drain", (t) => {
  const f = fixture(t),
    target = f.ticket({ stageId: f.stage("planning") });
  const batch = f.submit([target], 2);
  const claimed = f.claim(target);
  f.finish(claimed);
  f.coord.drain();
  const row = f.coord.get(batch.id).results[0];
  assert.equal(row.executionId, claimed.id);
  assert.equal(row.status, "checkpointed");
  assert.equal(f.runner.children.size, 0);
});

test("all overlapping batches bind a claim completed before subsequent drain without restarting it", (t) => {
  const f = fixture(t),
    target = f.ticket({ stageId: f.stage("planning") });
  const batches = [
    f.submit([target], 2),
    f.submit([target], 1),
    f.submit([target], 2),
  ];
  const claimed = f.claim(target);
  f.finish(claimed);

  // The claim and terminal report both arrive before any scheduled drain.
  // Every authorization must retain that execution, including after another drain.
  for (let pass = 0; pass < 2; pass++) {
    f.coord.drain();
    const executions = f.store.db
      .prepare("SELECT COUNT(*) AS count FROM executions WHERE ticket_id=?")
      .get(target.id).count;
    assert.equal(
      executions,
      1,
      "overlapping batches must not replay a completed claim",
    );
    assert.deepEqual(
      batches.map((batch) => {
        const row = f.coord.get(batch.id).results[0];
        return { executionId: row.executionId, status: row.status };
      }),
      batches.map(() => ({ executionId: claimed.id, status: "checkpointed" })),
      "all pending rows must bind the same exact execution",
    );
    assert.equal(f.runner.children.size, 0);
  }
});

test("synchronous preparation failure preserves the claimed execution in every overlapping batch", (t) => {
  const f = fixture(t),
    target = f.ticket({ stageId: f.stage("planning") });
  const batches = [f.submit([target], 2), f.submit([target], 1)];
  const normalStart = f.runner.start;
  let failedExecution,
    attempts = 0;
  f.runner.start = (ticketId) => {
    attempts++;
    const claimed = f.service.claim(ticketId, {
      agentId: target.ownerId,
      sessionId: randomUUID(),
    });
    failedExecution = f.service.event(claimed.id, {
      agentId: claimed.agentId,
      sessionId: claimed.sessionId,
      eventId: randomUUID(),
      seq: claimed.lastSeq + 1,
      type: "failed",
      progress: 13,
      summary: "Synthetic isolated-worktree preparation failed after claiming",
    });
    throw new AppError(422, "RUNNER_FAILED", failedExecution.summary);
  };
  f.coord.drain();
  f.runner.start = normalStart;
  assert.equal(attempts, 1, "the other batch must follow the failed claim");
  assert.equal(f.store.active(target.id), null);
  assert.equal(failedExecution.state, "failed");

  const assertFailedRows = () => {
    for (const batch of batches) {
      const row = f.coord.get(batch.id).results[0];
      assert.equal(
        row.executionId,
        failedExecution.id,
        "dispatch's local row must retain the claim binding even when start throws",
      );
      assert.equal(row.status, "failed");
      assert.equal(row.telemetry.state, "failed");
      assert.equal(row.telemetry.summary, failedExecution.summary);
      assert.equal(row.telemetry.progress, 13);
      assert.equal(row.telemetry.releasedAt, failedExecution.releasedAt);
    }
  };
  assertFailedRows();

  // An explicit new attempt may start, but old batch history must not adopt it.
  const replacement = f.runner.start(target.id);
  assert.notEqual(replacement.id, failedExecution.id);
  f.coord.drain();
  assertFailedRows();
  assert.equal(f.store.active(target.id).id, replacement.id);
  f.finish(replacement);
  f.coord.drain();
  assertFailedRows();
});

test(
  "real Runner child close flushes its checkpoint and automatically admits queued work",
  { timeout: 15000 },
  async (t) => {
    const f = fixture(t, { actualRunner: true });
    const first = f.ticket({ stageId: f.stage("planning") }),
      second = f.ticket({ stageId: f.stage("planning") });
    const ready = join(f.dir, "first-ready"),
      release = join(f.dir, "release-first"),
      secondStarted = join(f.dir, "second-started");
    const summary =
      "Synthetic child checkpoint published immediately before exit";
    const clientUrl = new URL("../bin/managed-client.mjs", import.meta.url)
      .href;
    writeFileSync(
      join(f.dir, "bin", "codex"),
      `#!${process.execPath}
(async () => {
  const fs = require("node:fs");
  const { randomUUID } = require("node:crypto");
  if (process.env.AGENT_DESK_TICKET_ID !== ${JSON.stringify(first.id)}) {
    fs.writeFileSync(${JSON.stringify(secondStarted)}, "started");
    setInterval(() => {}, 1000);
    return;
  }
  const { managedRequest, directoryIdentity, writeAtomic, requestLimit } = await import(${JSON.stringify(clientUrl)});
  const directory = process.env.AGENT_DESK_BRIDGE_DIR;
  await managedRequest(directory, "get_task", {}, { timeoutMs: 3000 });
  fs.writeFileSync(${JSON.stringify(ready)}, "ready");
  const timer = setInterval(() => {
    if (!fs.existsSync(${JSON.stringify(release)})) return;
    clearInterval(timer);
    const id = randomUUID();
    writeAtomic(directory, directoryIdentity(directory), id + ".request.json", {
      id,
      operation: "report_progress",
      input: { type: "checkpoint", summary: ${JSON.stringify(summary)}, eventId: randomUUID() }
    }, requestLimit);
    // Exit without waiting for a response: Runner must flush the pending report.
    process.exit(0);
  }, 10);
})().catch(error => { process.stderr.write(String(error)); process.exit(1); });
`,
      { mode: 0o700 },
    );

    const batch = f.submit([first, second], 1);
    // Deliberately never call drain: both admission steps must be event-driven.
    await waitFor(
      () => existsSync(ready),
      "the synthetic first child must complete its reporting handshake",
    );
    const firstExecution = f.store.active(first.id);
    assert.ok(firstExecution.reportingReadyAt);
    const firstChild = f.runner.children.get(firstExecution.id);
    assert.ok(firstChild?.pid);
    assert.equal(f.coord.get(batch.id).results[1].status, "queued");
    assert.equal(f.store.active(second.id), null);
    assert.equal(f.runner.children.size, 1);

    writeFileSync(release, "exit");
    await waitFor(
      () => existsSync(secondStarted),
      "child close must automatically re-admit the queued ticket",
    );
    const finalFirst = f.store.execution(firstExecution.id);
    assert.equal(firstChild.exitCode, 0);
    assert.equal(finalFirst.state, "checkpointed");
    assert.equal(
      finalFirst.summary,
      summary,
      "close must preserve the child's final mailbox event instead of synthesizing a fallback checkpoint",
    );
    assert.ok(finalFirst.releasedAt);
    assert.equal(f.runner.children.has(firstExecution.id), false);
    assert.equal(f.runner.children.size, 1);
    const rows = f.coord.get(batch.id).results;
    assert.deepEqual(
      rows.map((row) => row.status),
      ["checkpointed", "running"],
    );
    assert.equal(rows[0].executionId, firstExecution.id);
    assert.equal(rows[1].executionId, f.store.active(second.id).id);
  },
);

test("a capacity wait records its actual reason and does not churn unchanged queue state", (t) => {
  const f = fixture(t);
  f.claim(f.ticket({ ownerId: "claude", stageId: f.stage("planning") }), {
    managed: true,
  });
  const target = f.ticket();
  const batch = f.submit([target], 1);
  assert.match(
    batch.results[0].message,
    /dispatch/i,
    "initial acceptance is not an observed capacity shortage",
  );
  f.coord.drain();
  const row = f.coord.get(batch.id).results[0];
  assert.equal(row.status, "queued");
  assert.equal(typeof row.code, "string");
  assert.ok(row.code.length);
  assert.ok(Number.isFinite(Date.parse(row.queuedAt)));
  assert.match(row.message, /1/);
  const before = f.store.get("run-batch", batch.id);
  f.coord.drain();
  assert.deepEqual(f.store.get("run-batch", batch.id), before);
});

for (const problem of [
  "disabled agent",
  "unsupported adapter",
  "missing project",
  "scope conflict",
]) {
  test(`full capacity does not mask ${problem} validation`, (t) => {
    const f = fixture(t, { actualRunner: true });
    f.claim(f.ticket({ ownerId: "claude", stageId: f.stage("planning") }), {
      managed: true,
    });
    let target;
    if (problem === "scope conflict") {
      const other = f.ticket({ ownerId: "gemini", stageId: f.stage("active") });
      f.claim(other, { stale: true });
      target = f.ticket({ stageId: f.stage("active"), brief: other.brief });
    } else target = f.ticket({ stageId: f.stage("active") });
    if (problem === "disabled agent" || problem === "unsupported adapter") {
      const agent = f.service.require("agent", "codex");
      f.store.put("agent", {
        ...agent,
        ...(problem === "disabled agent"
          ? { enabled: false }
          : {
              adapter: "external",
              capabilities: { execute: false, report: true },
            }),
      });
    } else if (problem === "missing project") {
      f.service.updateProject(f.project.id, {
        path: join(f.dir, "missing-source"),
      });
    }
    const batch = f.submit([target], 1);
    f.coord.drain();
    const row = f.coord.get(batch.id).results[0];
    assert.equal(
      row.status,
      "failed",
      `${problem} must be visible before a capacity wait`,
    );
    assert.match(
      row.message,
      problem === "disabled agent"
        ? /disabled/i
        : problem === "unsupported adapter"
          ? /adapter|external|own client|connector/i
          : problem === "missing project"
            ? /project|path/i
            : /conflict|ready/i,
    );
    assert.equal(f.store.active(target.id), null);
    assert.equal(f.runner.children.size, 1);
  });
}

for (const problem of ["existing non-Git project", "missing origin/main"]) {
  for (const path of ["direct", "batch"]) {
    test(`full capacity does not mask ${problem} on ${path} launch`, (t) => {
      const f = fixture(t, { actualRunner: true });
      const occupied = f.claim(
        f.ticket({ ownerId: "claude", stageId: f.stage("planning") }),
        { managed: true },
      );
      const target = f.ticket({ stageId: f.stage("planning") });
      if (problem === "existing non-Git project") {
        const projectPath = join(f.dir, "not-a-git-repository");
        mkdirSync(projectPath);
        f.service.updateProject(f.project.id, { path: projectPath });
      } else {
        execFileSync(
          "git",
          ["-C", f.repo, "update-ref", "-d", "refs/remotes/origin/main"],
          { stdio: "ignore" },
        );
      }
      const batch = f.submit([target], 1);
      if (path === "direct") {
        assert.throws(
          () => f.runner.start(target.id),
          (error) => {
            assert.equal(error.code, "GIT_BASE");
            assert.match(error.message, /origin\/main|git/i);
            return true;
          },
        );
      } else {
        f.coord.drain();
        const row = f.coord.get(batch.id).results[0];
        assert.equal(
          row.status,
          "failed",
          "Git preparation must fail before a capacity wait",
        );
        assert.equal(row.code, "GIT_BASE");
        assert.match(row.message, /origin\/main|git/i);
      }
      assert.equal(f.store.active(target.id), null);
      assert.equal(
        f.store.latest(target.id),
        null,
        "invalid Git setup must not create a claim",
      );
      assert.equal(f.store.active(occupied.ticketId).id, occupied.id);
      assert.equal(f.runner.children.size, 1);
    });
  }
}
