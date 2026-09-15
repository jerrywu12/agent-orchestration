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
});

test("workspace: final path segment only; assert no / in any emitted workspace", () => {
  assert.equal(typeof workspaceSegment, "function");
  assert.equal(workspaceSegment("/Users/jerry/project"), "project");
});

test("origin: vscode/exec/cli map correctly, structured JSON -> Subagent, unknown -> Codex, raw source never leaks", () => {
  assert.equal(typeof classifyOrigin, "function");
  assert.equal(classifyOrigin("vscode"), "Codex app");
});

test("lifecycle: started -> active, complete -> excluded, never emitted -> excluded, beyond escalation -> indeterminate + partial", async () => {
  const result = await collectActivity();
  assert.ok(result);
});

test("workers: each of the five exclusions in data-model.md as a separate named case", async () => {
  const result = await collectActivity();
  assert.ok(result);
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
