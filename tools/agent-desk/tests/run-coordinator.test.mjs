import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.mjs";
import { Service } from "../server/service.mjs";
import { RunCoordinator } from "../server/run-coordinator.mjs";
const tick = () => new Promise((r) => setImmediate(r));
function fixture(
  t,
  trace = async () => ({
    tracking: "untraceable",
    processAlive: null,
    nativeSessionId: null,
    nativeThreadUrl: null,
    evidence: ["No matching native session; absence does not prove stopped."],
    reason: "Unable to trace.",
  }),
) {
  const store = new Store(":memory:"),
    service = new Service(store),
    project = service.createProject({
      name: "Recovery",
      repo: "fixture/recovery",
    });
  const ticket = (extra = {}) =>
    service.createTicket({
      projectId: project.id,
      title: "Fixture",
      brief: {
        specification: "Fixture specification",
        acceptanceCriteria: "Verify the behavior under test",
        scope: "Isolated fixture implementation",
        verification: "Run the focused fixture assertions",
        allowedPaths: `fixtures/${crypto.randomUUID()}/**`,
        conflictKeys: "none",
      },
      ownerId: "codex",
      stageId: service
        .state()
        .stages.find(
          (s) =>
            s.role ===
            (extra.blockedReason || extra.dependsOn?.length
              ? "active"
              : "ready"),
        ).id,
      ...extra,
    });
  const runner = {
    children: new Map(),
    start(key) {
      const t = service.require("ticket", key);
      const e = service.claim(
        key,
        { agentId: t.ownerId, sessionId: crypto.randomUUID() },
        { resolveBlockers: service.resolutionNeeded(t) },
      );
      runner.children.set(e.id, {});
      return e;
    },
  };
  const coord = new RunCoordinator(service, runner, { trace });
  t.after(() => {
    coord.close();
    store.close();
  });
  const oldClaim = (ticket) => {
    const e = service.claim(ticket.id, {
      agentId: "codex",
      sessionId: crypto.randomUUID(),
      external: true,
    });
    return store.saveExecution({
      ...e,
      heartbeatAt: new Date(Date.now() - 120000).toISOString(),
    });
  };
  return { store, service, project, ticket, runner, coord, oldClaim };
}
const confirm = (e) => ({
  executionId: e.id,
  sessionId: e.sessionId,
  expectedHeartbeatAt: e.heartbeatAt,
  confirmed: true,
  reason: "Session cannot be traced; preserve original worktree.",
});
test("stale recovery retains old work and fences old execution events with exact confirmation", async (t) => {
  const f = fixture(t),
    ticket = f.ticket(),
    old = f.oldClaim(ticket);
  const before = await f.coord.status(ticket.id);
  assert.equal(before.canTakeOver, true);
  assert.equal(before.history.length, 1);
  await assert.rejects(
    () => f.coord.takeover(ticket.id, { ...confirm(old), confirmed: false }),
    (e) => e.code === "CONFIRM_REQUIRED",
  );
  await assert.rejects(
    () =>
      f.coord.takeover(ticket.id, { ...confirm(old), executionId: "other" }),
    (e) => e.code === "EXECUTION_CHANGED",
  );
  await f.coord.takeover(ticket.id, confirm(old));
  assert.equal(f.store.active(ticket.id), null);
  assert.equal(f.store.execution(old.id).state, "revoked");
  const parked = f.store.get("ticket", ticket.id);
  assert.equal(f.store.get("stage", parked.stageId).role, "backlog");
  assert.match(parked.resumeReason, /retained/);
  assert.match(parked.resumeReason, /Previous process was not stopped/);
  const replacement = f.runner.start(ticket.id);
  assert.notEqual(replacement.id, old.id);
  assert.throws(
    () =>
      f.service.event(old.id, {
        agentId: old.agentId,
        sessionId: old.sessionId,
        eventId: "late",
        seq: 1,
        type: "progress",
        summary: "late",
      }),
    (e) => e.code === "EXECUTION_FINISHED",
  );
  assert.equal(f.store.active(ticket.id).id, replacement.id);
  assert.ok(f.store.activities().some((a) => a.kind === "claim_revoked"));
});
test("verified live or recently reporting sessions cannot be taken over", async (t) => {
  const f = fixture(t, async () => ({
    tracking: "process",
    processAlive: true,
    evidence: ["Exact process identity verified."],
  }));
  const old = f.oldClaim(f.ticket());
  assert.equal((await f.coord.status(old.ticketId)).canTakeOver, false);
  await assert.rejects(
    () => f.coord.takeover(old.ticketId, confirm(old)),
    (e) => e.code === "SESSION_TRACKED",
  );
  const g = fixture(t);
  const fresh = g.service.claim(g.ticket().id, {
    agentId: "codex",
    sessionId: "fresh",
  });
  await assert.rejects(
    () => g.coord.takeover(fresh.ticketId, confirm(fresh)),
    (e) => e.code === "SESSION_TRACKED",
  );
});
test("heartbeat changing while trace awaits refuses takeover", async (t) => {
  let release;
  const waiting = new Promise((r) => (release = r));
  const f = fixture(t, async () => {
    await waiting;
    return { tracking: "untraceable", processAlive: null, evidence: [] };
  });
  const old = f.oldClaim(f.ticket());
  const pending = f.coord.takeover(old.ticketId, confirm(old));
  f.service.event(old.id, {
    agentId: old.agentId,
    sessionId: old.sessionId,
    eventId: "new",
    seq: 1,
    type: "progress",
    summary: "I am working.",
  });
  release();
  await assert.rejects(
    () => pending,
    (e) => e.code === "EXECUTION_CHANGED",
  );
  assert.equal(f.store.active(old.ticketId).id, old.id);
});
test("bulk archive is partial and refuses active reservations", (t) => {
  const f = fixture(t),
    a = f.ticket(),
    b = f.ticket(),
    c = f.ticket();
  f.service.updateTicket(c.id, { version: c.version, archived: true });
  f.oldClaim(b);
  const result = f.coord.archive({ ticketIds: [a.id, b.id, c.id, "missing"] });
  assert.deepEqual(
    result.results.map((r) => r.status),
    ["archived", "failed", "skipped", "failed"],
  );
  assert.equal(f.service.getTicket(a.id).archived, true);
  assert.equal(f.service.getTicket(b.id).archived, false);
  assert.throws(
    () => f.coord.archive({ ticketIds: [] }),
    (e) => e.code === "VALIDATION",
  );
});
test("missing heartbeat evidence is explicitly stale, never falsely fresh", async (t) => {
  const f = fixture(t),
    old = f.oldClaim(f.ticket());
  const unknown = f.store.saveExecution({ ...old, heartbeatAt: "unknown" });
  assert.equal(unknown.stale, true);
  assert.equal((await f.coord.status(old.ticketId)).canTakeOver, true);
  await f.coord.takeover(old.ticketId, confirm(unknown));
  assert.equal(f.store.active(old.ticketId), null);
});

test("confirmed takeover accepts omitted or blank reasons and preserves an audit entry", async (t) => {
  for (const reason of [undefined, "", "  \n", "  User supplied context.  "]) {
    const f = fixture(t),
      ticket = f.ticket(),
      old = f.oldClaim(ticket);
    const input = { ...confirm(old) };
    if (reason === undefined) delete input.reason;
    else input.reason = reason;
    await f.coord.takeover(ticket.id, input);
    const saved = f.store.execution(old.id);
    assert.equal(saved.state, "revoked");
    assert.equal(
      saved.recoveryReason,
      reason?.trim() ||
        "Explicit takeover confirmed; no additional reason provided.",
    );
    assert.ok(
      f.store
        .activities()
        .some(
          (a) =>
            a.kind === "claim_revoked" &&
            a.summary.includes(saved.recoveryReason),
        ),
    );
    assert.equal(f.store.active(ticket.id), null);
    assert.equal(f.runner.children.size, 0);
  }
});
test("optional takeover notes retain validation and explicit confirmation", async (t) => {
  const f = fixture(t),
    ticket = f.ticket(),
    old = f.oldClaim(ticket);
  for (const reason of [null, 42, {}, [], "x".repeat(2001)]) {
    await assert.rejects(
      () => f.coord.takeover(ticket.id, { ...confirm(old), reason }),
      (e) => e.code === "VALIDATION",
    );
    assert.equal(f.store.active(ticket.id).id, old.id);
  }
  await assert.rejects(
    () =>
      f.coord.takeover(ticket.id, {
        ...confirm(old),
        reason: "",
        confirmed: false,
      }),
    (e) => e.code === "CONFIRM_REQUIRED",
  );
  assert.equal(f.store.active(ticket.id).id, old.id);
});

test("coordinator drain auto-synchronizes parent containers when children advance", async (t) => {
  const f = fixture(t);
  const planningStage = f.store.list("stage", f.project.id).find((s) => s.role === "planning").id;
  const reviewStage = f.store.list("stage", f.project.id).find((s) => s.role === "review").id;

  const parent = f.ticket({ stageId: planningStage });
  const child = f.ticket({ parentId: parent.id, stageId: reviewStage });

  f.coord.drain();

  const updatedParent = f.service.getTicket(parent.id);
  assert.equal(updatedParent.stageId, reviewStage);
});


