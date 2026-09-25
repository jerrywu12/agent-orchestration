import { expect, test, type Page } from "@playwright/test";
import type { DeskState } from "../src/types";
import { randomUUID } from "node:crypto";

test("Done clears checkpoint resume affordances in list board and details while preserving history", async ({
  page,
  request,
}) => {
  const projectResponse = await request.post("/api/projects", {
    data: {
      name: "Synthetic Done resume",
      key: `R${randomUUID().slice(0, 7)}`,
      repo: `fixture/${randomUUID()}`,
    },
  });
  expect(projectResponse.status()).toBe(201);
  const project = await projectResponse.json();
  const snapshot = await (await request.get("/api/state")).json();
  const stages = snapshot.stages.filter(
    (stage: any) => stage.projectId === project.id,
  );
  const response = await request.post("/api/tickets", {
    data: {
      projectId: project.id,
      stageId: stages.find((stage: any) => stage.role === "ready").id,
      ownerId: "codex",
      title: `Synthetic checkpoint ${randomUUID()}`,
      brief: {
        specification: "Synthetic spec",
        acceptanceCriteria: "No resume after Done",
        scope: "Synthetic module",
        verification: "Browser assertions",
        allowedPaths: `fixtures/${randomUUID()}.ts`,
        conflictKeys: "none",
      },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const ticket = await response.json();
  const claim = await request.post(`/api/tickets/${ticket.id}/claim`, {
    data: { agentId: "codex", sessionId: `synthetic-${randomUUID()}` },
  });
  expect(claim.status(), await claim.text()).toBe(201);
  const execution = await claim.json();
  const summary = "Synthetic saved checkpoint retained after completion";
  const checkpoint = await request.post(
    `/api/executions/${execution.id}/events`,
    {
      data: {
        agentId: "codex",
        sessionId: execution.sessionId,
        eventId: randomUUID(),
        seq: 1,
        type: "checkpoint",
        summary,
      },
    },
  );
  expect(checkpoint.ok(), await checkpoint.text()).toBeTruthy();
  const before = await (await request.get(`/api/tickets/${ticket.id}`)).json();
  expect(before.resumeReason).toBeTruthy();
  await page.route("**/api/integrations", (route) =>
    route.fulfill({
      json: {
        github: { available: false },
        agents: [{ id: "codex", available: true }],
      },
    }),
  );
  const starts: string[] = [];
  page.on("request", (req) => {
    if (
      req.method() === "POST" &&
      /\/(start|transition|runs)$/.test(new URL(req.url()).pathname)
    )
      starts.push(req.url());
  });
  await page.goto("/");
  const rowName = `${project.key}-${ticket.number} ${ticket.title}`;
  const row = page.getByRole("article", { name: rowName, exact: true });
  await expect(row.getByText("Resume needed", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: ticket.title, exact: true }).click();
  let dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Start agent", exact: true }),
  ).toHaveCount(0);
  await expect(dialog.getByText(before.resumeReason, { exact: true })).toBeVisible();
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  const done = await request.patch(`/api/tickets/${ticket.id}`, {
    data: {
      version: before.version,
      stageId: stages.find((stage: any) => stage.role === "done").id,
    },
  });
  expect(done.ok(), await done.text()).toBeTruthy();
  await page.reload();
  await expect(row.getByText("Resume needed", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Board view", exact: true }).click();
  await expect(
    page
      .getByRole("article", { name: rowName, exact: true })
      .getByText("Resume needed", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: ticket.title, exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Start agent", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByText(before.resumeReason, { exact: true }),
  ).toHaveCount(0);
  const after = await (await request.get(`/api/tickets/${ticket.id}`)).json();
  expect(after.execution.id).toBe(execution.id);
  expect(after.execution.summary).toBe(summary);
  expect(after.execution.state).toBe("checkpointed");
  expect(after.stageHistory.slice(0, before.stageHistory.length)).toEqual(
    before.stageHistory,
  );
  expect(after.stageHistory.at(-1).toStageName).toBe("Done");
  expect(starts).toEqual([]);
});

const now = "2026-09-13T12:00:00.000Z";
const nativeSessionId = "019c7714-3b77-74d1-9866-e1f484aae2ab";
function fixture(): DeskState {
  return {
    projects: [
      {
        id: "project",
        key: "SMARTSTO",
        name: "Recovery fixture",
        path: "/fixture/repo",
      },
    ],
    stages: ["Ready", "In progress", "Done"].map((name, i) => ({
      id: `stage-${i}`,
      name,
      projectId: "project",
      role: ["ready", "active", "done"][
        i
      ] as DeskState["stages"][number]["role"],
      position: i,
    })),
    agents: [{ id: "codex", name: "Codex", enabled: true, adapter: "codex" }],
    tickets: ["Normal work", "Blocked work", "Invisible session"].map(
      (title, i) => ({
        id: `ticket-${i}`,
        projectId: "project",
        number: 100 + i,
        title,
        stageId: i === 2 ? "stage-1" : "stage-0",
        ownerId: "codex",
        priority: "none",
        version: 1,
        createdAt: now,
        updatedAt: now,
        ...(i === 1 ? { blockedReason: "Needs dependency repair" } : {}),
        ...(i === 2
          ? {
              execution: {
                id: "old-execution",
                ticketId: "ticket-2",
                agentId: "codex",
                sessionId: "recorded-session",
                state: "running",
                external: true,
                heartbeatAt: "2026-09-12T12:00:00.000Z",
                worktreePath: "/fixture/preserved-worktree",
                branch: "codex/prior-work",
              },
            }
          : {}),
      }),
    ),
    activity: [],
    sync: [],
    capabilities: { localMode: true },
    serverTime: now,
  } as DeskState;
}
async function mockRecovery(page: Page) {
  const state = fixture();
  const writes: { path: string; body: any }[] = [];
  let status: any = {
    ticketId: "ticket-2",
    executionId: "old-execution",
    sessionId: "recorded-session",
    nativeSessionId,
    nativeThreadUrl: `codex://threads/${nativeSessionId}`,
    state: "running",
    tracking: "untraceable",
    processAlive: null,
    stale: true,
    canTakeOver: true,
    reason: "No managed runner or live process could be traced.",
    evidence: [
      "External ownership; no verified PID",
      "Recorded Codex session metadata only",
    ],
    worktreePath: "/fixture/preserved-worktree",
    branch: "codex/prior-work",
    lastHeartbeatAt: "2026-09-12T12:00:00.000Z",
    history: [
      {
        id: "older-execution",
        state: "checkpointed",
        summary: "Prior checkpoint retained",
        startedAt: now,
        releasedAt: now,
      },
    ],
  };
  let run: any = {
    id: "run-1",
    state: "running",
    concurrency: 2,
    createdAt: now,
    results: [
      { ticketId: "ticket-0", status: "running", message: "Agent started" },
      {
        ticketId: "ticket-1",
        status: "queued",
        message: "Blocker resolution queued",
      },
      {
        ticketId: "ticket-2",
        status: "needs_takeover",
        message: "Inspect the prior claim before takeover",
      },
    ],
  };
  let runReads = 0;
  let traceReads = 0;
  let failNextRun = false;
  let dropAcceptedRun = false;
  let delayAcceptedRun = false;
  let releaseAcceptedRun: (() => Promise<void>) | null = null;
  let acceptedRequestId: string | null = "run-1";
  let rejectTakeover = false;
  let dropTakeoverResponse = false;
  let delayTakeoverResponse = false;
  let releaseTakeoverResponse: (() => Promise<void>) | null = null;
  let failPoll = false;
  let failTrace = false;
  let failStateRefresh = false;
  await page.clock.install({ time: new Date(now) });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/state")
      return failStateRefresh
        ? route.fulfill({
            status: 503,
            json: { error: { message: "Ticket refresh unavailable" } },
          })
        : route.fulfill({ json: state });
    if (path === "/api/health")
      return route.fulfill({
        json: {
          status: "ok",
          root: "/fixture",
          sha: "fixture",
          storage: "temporary",
          version: "test",
        },
      });
    if (path === "/api/integrations")
      return route.fulfill({
        json: {
          github: { available: false },
          agents: [{ id: "codex", available: true }],
        },
      });
    if (path.endsWith("/execution-status")) {
      traceReads++;
      if (failTrace)
        return route.fulfill({
          status: 503,
          json: { error: { message: "Trace service unavailable" } },
        });
      return route.fulfill({ json: status });
    }
    if (path.startsWith("/api/runs/")) {
      runReads++;
      if (!acceptedRequestId || !path.endsWith(acceptedRequestId))
        return route.fulfill({
          status: 404,
          json: { error: { message: "Run batch not found." } },
        });
      if (failPoll)
        return route.fulfill({
          status: 503,
          json: { error: { message: "Run tracking unavailable" } },
        });
      return route.fulfill({ json: run });
    }
    if (request.method() !== "GET") {
      writes.push({ path, body: request.postDataJSON() });
      if (path === "/api/runs") {
        if (failNextRun) {
          failNextRun = false;
          return route.fulfill({
            status: 503,
            json: { error: { message: "Run response unavailable" } },
          });
        }
        acceptedRequestId = request.postDataJSON().requestId;
        run = { ...run, id: acceptedRequestId };
        if (dropAcceptedRun) {
          dropAcceptedRun = false;
          return route.abort("failed");
        }
        if (delayAcceptedRun) {
          delayAcceptedRun = false;
          const accepted = structuredClone(run);
          return new Promise<void>((resolve) => {
            releaseAcceptedRun = async () => {
              await route.fulfill({ status: 202, json: accepted });
              resolve();
            };
          });
        }
        return route.fulfill({ status: 202, json: run });
      }
      if (path === "/api/tickets/bulk-archive") {
        state.tickets[0].archived = true;
        return route.fulfill({
          json: {
            results: [
              { ticketId: "ticket-0", status: "archived", message: "Archived" },
              {
                ticketId: "ticket-1",
                status: "failed",
                message: "Archive storage unavailable",
              },
              {
                ticketId: "ticket-2",
                status: "skipped",
                message: "Active reservation retained",
              },
            ],
          },
        });
      }
      if (path.endsWith("/takeover")) {
        if (rejectTakeover)
          return route.fulfill({
            status: 409,
            json: {
              error: {
                message: "The claim changed. Inspect its current heartbeat.",
              },
            },
          });
        state.tickets[2].execution = {
          ...state.tickets[2].execution!,
          state: "checkpointed",
          releasedAt: now,
        };
        status = {
          ...status,
          state: "revoked",
          canTakeOver: false,
          reason: "Prior claim revoked. Work preserved.",
        };
        run = {
          ...run,
          results: run.results.map((row: any) =>
            row.ticketId === "ticket-2" && row.executionId === "old-execution"
              ? {
                  ...row,
                  status: "claim_released",
                  message: "Claim released; saved work retained.",
                  ...(row.telemetry
                    ? {
                        telemetry: {
                          ...row.telemetry,
                          state: "revoked",
                          releasedAt: now,
                        },
                      }
                    : {}),
                }
              : row,
          ),
        };
        if (dropTakeoverResponse) {
          dropTakeoverResponse = false;
          return route.abort("failed");
        }
        if (delayTakeoverResponse) {
          delayTakeoverResponse = false;
          const released = structuredClone(status);
          return new Promise<void>((resolve) => {
            releaseTakeoverResponse = async () => {
              await route.fulfill({ json: released });
              resolve();
            };
          });
        }
        return route.fulfill({ json: status });
      }
      return route.fulfill({ json: {} });
    }
    if (/\/api\/tickets\/ticket-\d$/.test(path))
      return route.fulfill({
        json: {
          ...state.tickets.find((item) => path.endsWith(item.id)),
          attachmentContext: [],
        },
      });
    return route.fulfill({ json: [] });
  });
  return {
    state,
    writes,
    updateRun: (changes: Record<string, unknown>) => {
      run = { ...run, ...changes };
    },
    setStatus: (value: object) => Object.assign(status, value),
    complete: () => {
      run = {
        ...run,
        state: "complete",
        results: [
          {
            ticketId: "ticket-0",
            status: "checkpointed",
            message: "Checkpoint saved",
          },
          {
            ticketId: "ticket-1",
            status: "awaiting_review",
            message: "Blocker repair ready for review",
          },
          run.results[2],
        ],
      };
    },
    reads: () => runReads,
    traceReads: () => traceReads,
    failNextRun: () => {
      failNextRun = true;
    },
    dropAcceptedRun: () => {
      dropAcceptedRun = true;
    },
    delayAcceptedRun: () => {
      delayAcceptedRun = true;
    },
    releaseAcceptedRun: async () => {
      if (!releaseAcceptedRun) throw new Error("No response is delayed");
      await releaseAcceptedRun();
    },
    nextRun: () => {
      run = {
        ...run,
        state: "running",
        results: [
          {
            ticketId: "ticket-1",
            status: "running",
            message: "Second batch remains tracked",
          },
        ],
      };
    },
    rejectTakeover: () => {
      rejectTakeover = true;
    },
    dropTakeoverResponse: () => {
      dropTakeoverResponse = true;
    },
    delayTakeoverResponse: () => {
      delayTakeoverResponse = true;
    },
    releaseTakeoverResponse: async () => {
      if (!releaseTakeoverResponse)
        throw new Error("No delayed takeover response");
      await releaseTakeoverResponse();
    },
    failPoll: () => {
      failPoll = true;
    },
    recoverPoll: () => {
      failPoll = false;
    },
    failTrace: () => {
      failTrace = true;
    },
    failStateRefresh: () => {
      failStateRefresh = true;
    },
  };
}


// Historical run records remain readable; new dispatch is covered by tracking-only tests.
async function takeoverBatch(page: Page) {
  const app = await mockRecovery(page);
  app.updateRun({
    state: "complete",
    results: [
      {
        ticketId: "ticket-2",
        executionId: "old-execution",
        status: "needs_takeover",
        message: "Inspect the prior claim before takeover",
      },
    ],
  });
  await page.addInitScript(() => sessionStorage.setItem(
    "agent-desk:last-bulk-run:v1",
    JSON.stringify({ id: "run-1", concurrency: 2, ticketIds: ["ticket-2"] }),
  ));
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Bulk run results" })).toBeVisible();
  return app;
}

function replaceDrawerExecution(app: Awaited<ReturnType<typeof mockRecovery>>) {
  app.state.tickets[2].execution = {
    ...app.state.tickets[2].execution!,
    id: "replacement-execution",
    sessionId: "replacement-session",
    state: "running",
    releasedAt: null,
    heartbeatAt: "2026-09-12T12:00:00.000Z",
  };
  app.setStatus({
    executionId: "replacement-execution",
    sessionId: "replacement-session",
    state: "running",
    canTakeOver: true,
    stale: true,
    processAlive: null,
    reason: "Replacement execution needs inspection",
  });
}

test("archive confirmation reports each outcome and selections follow filters", async ({
  page,
}) => {
  const app = await mockRecovery(page);
  await page.goto("/");
  await page.getByLabel("Select all visible tickets").check();
  await page.getByRole("button", { name: "Archive selected tickets" }).click();
  expect(app.writes).toHaveLength(0);
  await page
    .getByRole("button", { name: "Archive 3 tickets", exact: true })
    .click();
  await expect(page.getByText("Archive storage unavailable")).toBeVisible();
  await expect(page.getByText("Active reservation retained")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Archive results", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Archive results", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Search tickets").fill("Invisible");
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await page.getByLabel("Search tickets").fill("Blocked");
  await expect(page.getByText("0 selected", { exact: true })).toBeVisible();
});

test("untraceable session confirms without a checkbox and accepts an optional reason", async ({
  page,
}) => {
  const app = await takeoverBatch(page);
  await page.getByRole("button", { name: "Take over SMARTSTO-102", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Open in Codex" }),
  ).toHaveAttribute("href", `codex://threads/${nativeSessionId}`);
  await expect(
    page
      .locator(".execution-tracking")
      .getByText("/fixture/preserved-worktree", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("External ownership; no verified PID"),
  ).toBeVisible();

  const takeover = page.getByRole("button", {
    name: "Confirm takeover",
    exact: true,
  });
  await expect(takeover).toBeEnabled();
  await expect(
    page.locator(".takeover-confirmation").getByRole("checkbox"),
  ).toHaveCount(0);
  await page
    .getByLabel("Takeover reason")
    .fill("I verified the prior client cannot be found.");
  await expect(takeover).toBeEnabled();
  await takeover.click();
  expect(
    app.writes.find((item) => item.path.endsWith("/takeover"))?.body,
  ).toEqual({
    executionId: "old-execution",
    sessionId: "recorded-session",
    expectedHeartbeatAt: "2026-09-12T12:00:00.000Z",
    reason: "I verified the prior client cannot be found.",
    confirmed: true,
  });
  await expect(page.getByRole("status").filter({ hasText: "Takeover complete" })).toBeVisible();
  expect(app.writes.some((item) => item.path.endsWith("/start"))).toBe(false);
  await expect(
    page.getByRole("button", { name: "Run Agent for SMARTSTO-102", exact: true }),
  ).toHaveCount(0);
});

test("verified live session and failed trace cannot offer takeover", async ({
  page,
}) => {
  const app = await takeoverBatch(page);
  app.setStatus({
    processAlive: true,
    tracking: "process",
    stale: false,
    canTakeOver: false,
    reason: "Verified live background process PID 4242",
  });
  await page.getByRole("button", { name: "Take over SMARTSTO-102", exact: true }).click();
  await expect(
    page.getByText("Verified live background process PID 4242"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm takeover", exact: true }),
  ).toBeDisabled();
  app.failTrace();
  await page.getByRole("button", { name: "Refresh execution trace" }).click();
  await expect(page.getByText("Trace service unavailable")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm takeover", exact: true }),
  ).toBeDisabled();
});

test("takeover conflict keeps the reason visible and requires refreshed trace before retry", async ({
  page,
}) => {
  const app = await takeoverBatch(page);
  app.rejectTakeover();
  await page.getByRole("button", { name: "Take over SMARTSTO-102", exact: true }).click();
  await page
    .getByLabel("Takeover reason")
    .fill("Prior session cannot be located.");
  await page
    .getByRole("button", { name: "Confirm takeover", exact: true })
    .click();
  await expect(
    page.getByText("The claim changed. Inspect its current heartbeat."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm takeover", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("Takeover reason")).toHaveValue(
    "Prior session cannot be located.",
  );
  await page.clock.fastForward(4100);
  await expect(
    page.getByText("The claim changed. Inspect its current heartbeat."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  const reads = app.traceReads();
  await page.clock.fastForward(6000);
  expect(app.traceReads()).toBe(reads);
  expect(app.writes.some((item) => item.path.endsWith("/start"))).toBe(false);
});

test("ticket drawer retains a human draft when an external execution is replaced", async ({ page }) => {
  const app = await mockRecovery(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Invisible session", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Description", exact: true }).fill("Keep this human draft.");
  replaceDrawerExecution(app);
  await page.clock.fastForward(8100);
  await expect(dialog.getByRole("textbox", { name: "Description", exact: true })).toHaveValue("Keep this human draft.");
  await expect(dialog.locator(".execution-tracking")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Take over prior claim", exact: true })).toHaveCount(0);
  expect(app.traceReads()).toBe(0);
  expect(app.writes).toEqual([]);
});

test("opening and closing the ticket drawer never starts execution trace polling", async ({ page }) => {
  const app = await mockRecovery(page);
  await page.goto("/");
  for (let visit = 0; visit < 2; visit++) {
    await page.getByRole("button", { name: "Invisible session", exact: true }).click();
    await page.clock.fastForward(8100);
    await expect(page.getByRole("dialog").locator(".execution-tracking")).toHaveCount(0);
    await page.getByRole("button", { name: "Close dialog" }).click();
    await page.clock.fastForward(4100);
  }
  expect(app.traceReads()).toBe(0);
  expect(app.writes).toEqual([]);
});

test("bulk takeover can confirm with an empty reason and no acknowledgement", async ({ page }) => {
  const app = await takeoverBatch(page);
  await page.getByRole("button", { name: "Take over SMARTSTO-102", exact: true }).click();
  const confirm = page.getByRole("button", { name: "Confirm takeover", exact: true });
  await expect(confirm).toBeEnabled();
  await expect(page.getByLabel("Takeover reason")).toHaveValue("");
  await expect(page.locator(".takeover-confirmation").getByRole("checkbox")).toHaveCount(0);
  await confirm.click();
  await expect.poll(() => app.writes.filter(item => item.path.endsWith("/takeover")).length).toBe(1);
  expect(app.writes.find(item => item.path.endsWith("/takeover"))?.body).toMatchObject({ executionId: "old-execution", sessionId: "recorded-session", confirmed: true, reason: "" });
  expect(app.writes.some(item => item.path.endsWith("/start"))).toBe(false);
});

test("stopped work shows a resume badge and preserves the full reason in details", async ({
  page,
}) => {
  const app = await mockRecovery(page);
  const reason = "Agent stopped; saved work retained. Resume in the assigned agent client.";
  app.state.tickets[0].resumeReason = reason;
  app.state.tickets[0].execution = null;
  await page.goto("/");
  const row = page.getByRole("article", { name: "SMARTSTO-100 Normal work" });
  await expect(row.getByText("Resume needed", { exact: true })).toHaveAttribute(
    "title",
    reason,
  );
  await row.getByRole("button", { name: "Normal work", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText(reason, { exact: true }),
  ).toBeVisible();
  expect(app.writes).toHaveLength(0);
});

test("a recovery-only batch says action required instead of agent run finished", async ({
  page,
}) => {
  await takeoverBatch(page);
  await expect(
    page.getByRole("heading", { name: "Action required", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Waiting for takeover", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Agent run finished", exact: true }),
  ).toHaveCount(0);
});
test("unknown launch status is not mislabeled as a failed launch and clears after repair", async ({
  page,
  request,
}) => {
  const p = await (
    await request.post("/api/projects", {
      data: {
        name: "Launch repair fixture",
        key: `L${randomUUID().slice(0, 7)}`,
        repo: `fixture/${randomUUID()}`,
      },
    })
  ).json();
  const state = await (await request.get("/api/state")).json();
  const done = state.stages.find(
    (s: any) => s.projectId === p.id && s.role === "done",
  );
  const ticket = await (
    await request.post("/api/tickets", {
      data: {
        projectId: p.id,
        title: `Malformed launch ${randomUUID()}`,
        stageId: done.id,
      },
    })
  ).json();
  let malformed = true;
  await page.route("**/api/state", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.tickets = body.tickets.map((t: any) =>
      t.id === ticket.id
        ? { ...t, launchIntent: malformed ? { ...ticket } : null }
        : t,
    );
    await route.fulfill({ response, json: body });
  });
  await page.goto("/");
  const row = page.getByRole("article", {
    name: `${p.key}-${ticket.number} ${ticket.title}`,
    exact: true,
  });
  await expect(
    row.getByText("Launch status unavailable", { exact: true }),
  ).toBeVisible();
  await expect(row.getByText("Launch failed", { exact: true })).toHaveCount(0);
  malformed = false;
  await page.reload();
  await expect(row).toBeVisible();
  await expect(
    row.getByText("Launch status unavailable", { exact: true }),
  ).toHaveCount(0);
});
