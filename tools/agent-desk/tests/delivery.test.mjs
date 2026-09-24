import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.mjs";
import { Service } from "../server/service.mjs";
import { createAppServer } from "../server/http.mjs";

const prUrl = "https://github.com/fixture/delivery/pull/17";
const headSha = "a".repeat(40);
const mergeCommitSha = "b".repeat(40);

async function fixture(t, pullRequest = {}) {
  const store = new Store(":memory:");
  const service = new Service(store);
  const project = service.createProject({ name: "Delivery", repo: "fixture/delivery" });
  const stages = Object.fromEntries(
    store.list("stage", project.id).map((stage) => [stage.role, stage.id]),
  );
  const ticket = service.createTicket({
    projectId: project.id,
    title: "Verified work",
    ownerId: "codex",
    stageId: stages.ready,
    brief: {
      specification: "Test delivery",
      acceptanceCriteria: "Merged review evidence",
      scope: "Bounded implementation",
      verification: "Tests and runtime",
      allowedPaths: "fixtures/delivery/**",
      conflictKeys: "delivery-test",
    },
  });
  const execution = service.claim(ticket.id, {
    agentId: "codex",
    sessionId: "native-session",
  });
  let lookups = 0;
  const syncManager = {
    client: {
      getPullRequest: async (repo, number) => {
        lookups += 1;
        assert.equal(repo, "fixture/delivery");
        assert.equal(number, 17);
        return {
          repo,
          number,
          url: prUrl,
          state: "closed",
          merged: true,
          mergedAt: "2026-09-24T12:00:00Z",
          headSha,
          mergeCommitSha,
          ...pullRequest,
        };
      },
    },
  };
  const server = createAppServer({
    service,
    runner: { availability: () => [] },
    syncManager,
    agentTokens: { codex: "codex-token", claude: "claude-token" },
    adminToken: "admin-token",
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = async (id, payload, token = "codex-token") => {
    const response = await fetch(`${url}/api/tickets/${id}/deliver`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    return { status: response.status, data: await response.json() };
  };
  const evidence = () => ({
    executionId: execution.id,
    sessionId: execution.sessionId,
    version: service.getTicket(ticket.id).version,
    reviewerId: "independent-reviewer",
    reviewedHeadSha: headSha,
    reviewEvidence: "Independent exact-head review approved the change.",
    verificationEvidence: "Full gate passed at the reviewed head.",
    runtimeEvidence: "Merged-main browser journey passed.",
  });
  const complete = () => service.event(execution.id, {
    agentId: "codex",
    sessionId: execution.sessionId,
    eventId: "completed",
    seq: 1,
    type: "complete",
    summary: "Implementation ready for review",
    prUrl,
    headSha,
  });
  return { store, service, stages, ticket, execution, request, evidence, complete, lookups: () => lookups };
}

test("assigned agent can deliver its reviewed execution after the linked PR is verified merged", async (t) => {
  const f = await fixture(t);
  f.complete();
  const response = await f.request(f.ticket.id, f.evidence());
  assert.equal(response.status, 200);
  assert.equal(response.data.stageId, f.stages.done);
  assert.equal(response.data.delivery.prUrl, prUrl);
  assert.equal(response.data.delivery.mergeCommitSha, mergeCommitSha);
  assert.equal(response.data.delivery.executionId, f.execution.id);
  assert.equal(f.lookups(), 1);
  assert.equal(f.store.active(f.ticket.id), null);
  assert.ok(f.store.activities().some((activity) => activity.kind === "agent_delivered"));
});

test("delivery rejects live claims, foreign credentials, stale versions and absent evidence", async (t) => {
  const f = await fixture(t);
  let response = await f.request(f.ticket.id, f.evidence());
  assert.equal(response.status, 409);
  assert.equal(f.lookups(), 0);
  f.complete();
  response = await f.request(f.ticket.id, f.evidence(), "claude-token");
  assert.equal(response.status, 403);
  response = await f.request(f.ticket.id, { ...f.evidence(), version: 1 });
  assert.equal(response.status, 409);
  response = await f.request(f.ticket.id, { ...f.evidence(), reviewEvidence: "" });
  assert.equal(response.status, 422);
  response = await f.request(f.ticket.id, { ...f.evidence(), reviewerId: "codex" });
  assert.equal(response.status, 422);
  response = await f.request(f.ticket.id, { ...f.evidence(), reviewedHeadSha: "c".repeat(40) });
  assert.equal(response.status, 409);
  assert.equal(f.lookups(), 0);
  assert.equal(f.service.getTicket(f.ticket.id).stageId, f.stages.review);
});

test("delivery rechecks blockers and unfinished dependencies after completion", async (t) => {
  const f = await fixture(t);
  f.complete();
  const review = f.service.getTicket(f.ticket.id);
  f.service.updateTicket(f.ticket.id, { version: review.version, blockedReason: "Acceptance evidence missing" });
  let response = await f.request(f.ticket.id, f.evidence());
  assert.equal(response.status, 409);
  assert.equal(f.lookups(), 0);
  const blocked = f.service.getTicket(f.ticket.id);
  const dependency = f.service.createTicket({ projectId: f.ticket.projectId, title: "Pending dependency" });
  f.service.updateTicket(f.ticket.id, {
    version: blocked.version,
    blockedReason: "",
    dependsOn: [dependency.id],
  });
  response = await f.request(f.ticket.id, f.evidence());
  assert.equal(response.status, 409);
  assert.equal(f.lookups(), 0);
  assert.equal(f.service.getTicket(f.ticket.id).stageId, f.stages.review);
});

test("delivery fails closed for unmerged GitHub PR evidence", async (t) => {
  const f = await fixture(t, { merged: false, mergedAt: null });
  f.complete();
  const response = await f.request(f.ticket.id, f.evidence());
  assert.equal(response.status, 409);
  assert.equal(f.service.getTicket(f.ticket.id).stageId, f.stages.review);
});

test("delivery rejects a changed PR head and preserves review stage", async (t) => {
  const f = await fixture(t, { headSha: "c".repeat(40) });
  f.complete();
  const response = await f.request(f.ticket.id, f.evidence());
  assert.equal(response.status, 409);
  assert.equal(response.data.error.code, "PR_MISMATCH");
  assert.equal(f.service.getTicket(f.ticket.id).stageId, f.stages.review);
});

test("delivery rejects a previous session and cannot repeat the transition", async (t) => {
  const f = await fixture(t);
  f.complete();
  const evidence = f.evidence();
  let response = await f.request(f.ticket.id, { ...evidence, sessionId: "other" });
  assert.equal(response.status, 403);
  response = await f.request(f.ticket.id, evidence);
  assert.equal(response.status, 200);
  response = await f.request(f.ticket.id, evidence);
  assert.equal(response.status, 409);
  assert.equal(f.lookups(), 1);
  assert.equal(f.store.activities().filter((activity) => activity.kind === "agent_delivered").length, 1);
});
