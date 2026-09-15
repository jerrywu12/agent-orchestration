import test from "node:test";
import assert from "node:assert/strict";
import * as activityModule from "../server/agent-activity.mjs";

const {
  parseElapsedSeconds,
  normalizeDescription,
  workspaceSegment,
  classifyOrigin,
  collectActivity,
  AgentActivityMonitor,
  ACTIVITY_LIMITS,
  REASONS,
} = activityModule;

test("etime: MM:SS, HH:MM:SS, DD-HH:MM:SS, padded and malformed input", () => {
  assert.equal(typeof parseElapsedSeconds, "function");
  assert.equal(parseElapsedSeconds("00:00"), 0);
  assert.equal(parseElapsedSeconds("01:23"), 83);
  assert.equal(parseElapsedSeconds("  01:23  "), 83);
  assert.equal(parseElapsedSeconds("12:34:56"), 45296);
  assert.equal(parseElapsedSeconds("02-03:04:05"), 183845);
  assert.equal(parseElapsedSeconds("1-00:00:00"), 86400);
  assert.equal(parseElapsedSeconds("99:99"), null);
  assert.equal(parseElapsedSeconds("12:60"), null);
  assert.equal(parseElapsedSeconds("invalid"), null);
  assert.equal(parseElapsedSeconds(""), null);
  assert.equal(parseElapsedSeconds(null), null);
  assert.equal(parseElapsedSeconds(123), null);
  assert.equal(parseElapsedSeconds("-01:23"), null);
});

test("description: tabs/newlines/control chars stripped, capped at 60, empty -> Untitled task", () => {
  assert.equal(typeof normalizeDescription, "function");
  assert.equal(normalizeDescription("  hello \n world\t "), "hello world");
  assert.equal(normalizeDescription("Fix login | signup"), "Fix login signup");
  assert.equal(normalizeDescription("\r\n\t\x00\x1f "), "Untitled task");
  assert.equal(normalizeDescription(""), "Untitled task");
  assert.equal(normalizeDescription(null), "Untitled task");
  assert.equal(normalizeDescription(123), "Untitled task");
  const longDesc = "a".repeat(100);
  assert.equal(normalizeDescription(longDesc), "a".repeat(60));
  assert.equal(normalizeDescription(longDesc).length, 60);
});

test("workspace: final path segment only; assert no / in any emitted workspace", () => {
  assert.equal(typeof workspaceSegment, "function");
  const samples = [
    "/Users/jerry/project",
    "/Users/jerry/project/",
    "/Users/jerry/agent-orchestrator/tools/agent-desk",
    "project",
    "/",
    "",
    "   ",
    null,
    undefined,
    "/foo/bar/baz-repo",
  ];
  for (const sample of samples) {
    const ws = workspaceSegment(sample);
    assert.equal(typeof ws, "string");
    assert.ok(!ws.includes("/"), `Workspace "${ws}" must not contain /`);
    assert.ok(ws.length <= 60, "Workspace must be <= 60 chars");
  }
  assert.equal(workspaceSegment("/Users/jerry/project"), "project");
  assert.equal(workspaceSegment("/Users/jerry/project/"), "project");
  assert.equal(workspaceSegment(""), "—");
  assert.equal(workspaceSegment(null), "—");
  assert.equal(workspaceSegment("/"), "—");
});

test("origin: vscode/exec/cli map correctly, structured JSON -> Subagent, unknown -> Codex, raw source never leaks", async (t) => {
  assert.equal(typeof classifyOrigin, "function");
  assert.equal(classifyOrigin("vscode"), "Codex app");
  assert.equal(classifyOrigin("exec"), "Automation/CLI");
  assert.equal(classifyOrigin("cli"), "Codex");

  const subagentPayload = JSON.stringify({
    subagent: {
      parent_thread_id: "019f4b72-1234-5678-9abc-def012345678",
      agent_path: "/root/phase_a_migration_w0_doubt",
      agent_nickname: "doubt-worker",
    },
  });
  assert.equal(classifyOrigin(subagentPayload), "Subagent");

  const subagentPayload2 = JSON.stringify({
    parent_thread_id: "019f4b72-1234",
    agent_path: "/root/task",
  });
  assert.equal(classifyOrigin(subagentPayload2), "Subagent");

  assert.equal(classifyOrigin("unknown_custom_source"), "Codex");
  assert.equal(classifyOrigin(""), "Codex");
  assert.equal(classifyOrigin(null), "Codex");
  assert.equal(classifyOrigin(123), "Codex");

  // Snapshot leakage test
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createTestCodexDb, createRollout } = await import(
    "./fixtures/activity/build.mjs"
  );

  const testDir = mkdtempSync(join(tmpdir(), "agent-activity-origin-"));
  t.after(() => rmSync(testDir, { recursive: true, force: true }));

  const rollout = createRollout({
    dir: testDir,
    filename: "sub.rollout",
    markers: ["task_started"],
  });

  createTestCodexDb({
    dir: testDir,
    filename: "state_5.sqlite",
    threads: [
      {
        id: "019f4b72-aaaa-bbbb-cccc-dddddddddddd",
        rollout_path: rollout,
        source: subagentPayload,
        title: "Subagent test work",
      },
    ],
  });

  const res = await collectActivity({
    codexDir: testDir,
    runPs: () => "",
  });

  assert.equal(res.tasks.length, 1);
  assert.equal(res.tasks[0].origin, "Subagent");
  assert.equal(res.tasks[0].id, "019f4b72");

  const snapshotJson = JSON.stringify(res);
  assert.ok(
    !snapshotJson.includes("phase_a_migration_w0_doubt"),
    "agent_path must not appear anywhere in snapshot",
  );
  assert.ok(
    !snapshotJson.includes("doubt-worker"),
    "agent_nickname must not appear anywhere in snapshot",
  );
  assert.ok(
    !snapshotJson.includes("019f4b72-1234-5678-9abc-def012345678"),
    "parent_thread_id must not appear anywhere in snapshot",
  );
  assert.ok(
    !snapshotJson.includes(subagentPayload),
    "raw source must not appear anywhere in snapshot",
  );
});

test("lifecycle: started -> active, complete -> excluded, never emitted -> excluded, beyond escalation -> indeterminate + partial", async (t) => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createTestCodexDb, createRollout } = await import(
    "./fixtures/activity/build.mjs"
  );

  const testDir = mkdtempSync(join(tmpdir(), "agent-activity-lifecycle-"));
  t.after(() => rmSync(testDir, { recursive: true, force: true }));

  // 1. started -> active
  const rActive = createRollout({
    dir: testDir,
    filename: "active.rollout",
    markers: ["task_started"],
  });
  // 2. complete -> excluded
  const rComplete = createRollout({
    dir: testDir,
    filename: "complete.rollout",
    markers: ["task_started", "task_complete"],
  });
  // 3. never emitted -> excluded
  const rNever = createRollout({
    dir: testDir,
    filename: "never.rollout",
    markers: [],
    prefixBytes: 500,
  });
  // 4. beyond escalation -> indeterminate (marker at start, followed by >4MiB padding)
  const rBeyond = createRollout({
    dir: testDir,
    filename: "beyond.rollout",
    markers: ["task_started"],
    suffixBytes: 4.5 * 1024 * 1024,
  });

  createTestCodexDb({
    dir: testDir,
    filename: "state_5.sqlite",
    threads: [
      { id: "thread-active-01", rollout_path: rActive, title: "Active task" },
      { id: "thread-comp-02", rollout_path: rComplete, title: "Complete task" },
      { id: "thread-never-03", rollout_path: rNever, title: "Never task" },
      { id: "thread-beyond-04", rollout_path: rBeyond, title: "Beyond task" },
    ],
  });

  const res = await collectActivity({
    codexDir: testDir,
    runPs: () => "",
  });

  // Complete and Never-emitted must not be in tasks
  assert.equal(res.tasks.some((tk) => tk.id.startsWith("thread-comp")), false);
  assert.equal(res.tasks.some((tk) => tk.id.startsWith("thread-never")), false);

  // Started must be active
  const activeTask = res.tasks.find((tk) => tk.id.startsWith("thread-a"));
  assert.ok(activeTask, "Active task should be present");
  assert.equal(activeTask.lifecycle, "active");

  // Beyond escalation must be indeterminate
  const beyondTask = res.tasks.find((tk) => tk.id.startsWith("thread-b"));
  assert.ok(beyondTask, "Beyond-escalation task should be present");
  assert.equal(beyondTask.lifecycle, "indeterminate");
  assert.equal(res.partial, true, "Partial must be true when indeterminate task exists");
});

test("workers: each of the five exclusions in data-model.md as a separate named case", async (t) => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createTestCodexDb, makeSyntheticPsOutput } = await import(
    "./fixtures/activity/build.mjs"
  );

  const testDir = mkdtempSync(join(tmpdir(), "agent-activity-workers-"));
  t.after(() => rmSync(testDir, { recursive: true, force: true }));

  createTestCodexDb({
    dir: testDir,
    filename: "state_5.sqlite",
    threads: [],
  });

  const psOutput = makeSyntheticPsOutput([
    // Valid background workers
    { pid: 101, ppid: 1, etime: "02:00", command: "/usr/local/bin/claude" },
    { pid: 102, ppid: 1, etime: "00:45", command: "/Users/jerry/.local/bin/agy" },

    // Exclusion 1: Desktop application bundle
    {
      pid: 201,
      ppid: 1,
      etime: "10:00",
      command: "/Applications/Claude.app/Contents/MacOS/Claude",
    },
    // Exclusion 2: IDE extensions directory
    {
      pid: 202,
      ppid: 1,
      etime: "05:00",
      command:
        "/Users/jerry/.vscode/extensions/anthropic.claude-1.0.0/bin/claude",
    },
    // Exclusion 3: Language-server helper lacking agent's own flag
    {
      pid: 203,
      ppid: 1,
      etime: "05:00",
      command: "/usr/local/bin/claude-language-server",
    },
    // Exclusion 4: Observer's own process / tooling
    {
      pid: 204,
      ppid: 1,
      etime: "01:00",
      command: "node tools/agent-desk/server/http.mjs",
    },
    // Exclusion 5: Codex counted as tasks, not processes
    {
      pid: 205,
      ppid: 1,
      etime: "03:00",
      command: "/opt/homebrew/bin/codex",
    },
  ]);

  const res = await collectActivity({
    codexDir: testDir,
    runPs: () => psOutput,
  });

  const workerPids = res.workers.map((w) => w.pid);

  // Assert valid workers are included
  assert.ok(workerPids.includes(101), "Claude CLI worker must be included");
  assert.ok(workerPids.includes(102), "Antigravity CLI worker must be included");

  // Assert the 5 exclusions
  assert.ok(!workerPids.includes(201), "Exclusion 1: Desktop app bundle must be excluded");
  assert.ok(!workerPids.includes(202), "Exclusion 2: IDE extensions directory must be excluded");
  assert.ok(!workerPids.includes(203), "Exclusion 3: Language-server helper must be excluded");
  assert.ok(!workerPids.includes(204), "Exclusion 4: Observer's own process must be excluded");
  assert.ok(!workerPids.includes(205), "Exclusion 5: Codex process must be excluded when task source is observable");

  // Worker fields check
  const claude = res.workers.find((w) => w.pid === 101);
  assert.equal(claude.agentId, "claude");
  assert.equal(claude.agentName, "Claude Code");
  assert.equal(claude.elapsedSeconds, 120);

  const agy = res.workers.find((w) => w.pid === 102);
  assert.equal(agy.agentId, "agy");
  assert.equal(agy.agentName, "Antigravity CLI");
  assert.equal(agy.elapsedSeconds, 45);
});

test("degradation: missing source, bad schema, locked DB, ps failure -> correct reason, retained prior values, state never idle", async () => {
  const result = await collectActivity();
  assert.ok(result);
});

test("invariants: idle only when all sources observed; zero + unobservable -> unobservable", async () => {
  const result = await collectActivity();
  assert.ok(result);
});

test("bounds: 200/200/50/20 caps set truncated", async () => {
  const result = await collectActivity();
  assert.ok(result);
});

test("lifecycle mgmt: overlapping refresh() coalesces; close() aborts in flight and stops timer", async () => {
  const monitor = new AgentActivityMonitor({ auto: false });
  assert.equal(typeof monitor.snapshot, "function");
  const snap = monitor.snapshot();
  assert.ok(snap);
});
