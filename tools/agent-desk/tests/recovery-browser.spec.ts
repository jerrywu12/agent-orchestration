import { expect, test, type Page } from "@playwright/test";
import type { DeskState } from "../src/types";

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
  let acceptedRequestId: string | null = null;
  let rejectTakeover = false;
  let failPoll = false;
  let failTrace = false;
  await page.clock.install({ time: new Date(now) });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/state") return route.fulfill({ json: state });
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
          state: "checkpointed",
          canTakeOver: false,
          reason: "Prior claim revoked. Work preserved.",
        };
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
    rejectTakeover: () => {
      rejectTakeover = true;
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
  };
}

test("bulk run tracks normal, blocked and stale tickets without taking over", async ({
  page,
}) => {
  const app = await mockRecovery(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /All work/ })).toBeVisible();
  await expect(page.getByLabel("Select all visible tickets")).toBeVisible();
  await page.getByLabel("Select all visible tickets").check();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("3 selected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Run Agent", exact: true }).click();
  expect(app.writes[0]).toMatchObject({
    path: "/api/runs",
    body: { ticketIds: ["ticket-0", "ticket-1", "ticket-2"], concurrency: 2 },
  });
  expect(app.writes[0].body.requestId).toMatch(/^[a-f0-9-]{36}$/);
  await expect(page.getByText("Blocker resolution queued")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Inspect takeover for SMARTSTO-102" }),
  ).toBeVisible();
  app.complete();
  await page.clock.fastForward(2100);
  await expect(page.getByText("Checkpoint saved")).toBeVisible();
  const reads = app.reads();
  await page.clock.fastForward(6000);
  expect(app.reads()).toBe(reads);
  expect(app.writes.some((item) => item.path.endsWith("/takeover"))).toBe(
    false,
  );
});

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
  await page.getByLabel("Search tickets").fill("Invisible");
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await page.getByLabel("Search tickets").fill("Blocked");
  await expect(page.getByText("0 selected", { exact: true })).toBeVisible();
});

test("untraceable session exposes native reference and requires an explicit takeover reason", async ({
  page,
}) => {
  const app = await mockRecovery(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Invisible session", exact: true })
    .click();
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
  await page
    .getByRole("button", { name: "Take over prior claim", exact: true })
    .click();
  const takeover = page.getByRole("button", {
    name: "Confirm takeover",
    exact: true,
  });
  await expect(takeover).toBeDisabled();
  await page
    .getByLabel("Takeover reason")
    .fill("I verified the prior client cannot be found.");
  await expect(takeover).toBeDisabled();
  await page
    .getByLabel(
      "I understand the prior process may still exist and will preserve its work.",
    )
    .check();
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
  await expect(
    page.getByText(
      "Prior claim released. Existing work is preserved. You can now start an agent.",
    ),
  ).toBeVisible();
  expect(app.writes.some((item) => item.path.endsWith("/start"))).toBe(false);
  await expect(
    page.getByRole("button", { name: "Start agent", exact: true }),
  ).toBeEnabled();
});

test("verified live session and failed trace cannot offer takeover", async ({
  page,
}) => {
  const app = await mockRecovery(page);
  app.setStatus({
    processAlive: true,
    tracking: "process",
    stale: false,
    canTakeOver: false,
    reason: "Verified live background process PID 4242",
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Invisible session", exact: true })
    .click();
  await expect(
    page.getByText("Verified live background process PID 4242"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Take over prior claim", exact: true }),
  ).toHaveCount(0);
  app.failTrace();
  await page.getByRole("button", { name: "Refresh execution trace" }).click();
  await expect(page.getByText("Trace service unavailable")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Take over prior claim", exact: true }),
  ).toHaveCount(0);
});

test("run polling pauses on failure and stops after leaving All work", async ({
  page,
}) => {
  const app = await mockRecovery(page);
  await page.goto("/");
  await page.getByLabel("Select ticket SMARTSTO-100").check();
  await page.getByRole("button", { name: "Run Agent", exact: true }).click();
  app.failPoll();
  await page.clock.fastForward(2100);
  await expect(page.getByText("Run tracking unavailable")).toBeVisible();
  const failedReads = app.reads();
  await page.clock.fastForward(5000);
  expect(app.reads()).toBe(failedReads);
  app.recoverPoll();
  await page.getByRole("button", { name: "Retry run tracking" }).click();
  await expect(page.getByText("Run tracking unavailable")).toHaveCount(0);
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  const reads = app.reads();
  await page.clock.fastForward(6000);
  expect(app.reads()).toBe(reads);
});

test("bulk selection is capped at 100 and board selection keeps the ticket closed", async ({
  page,
}) => {
  const app = await mockRecovery(page);
  app.state.tickets = Array.from({ length: 101 }, (_, index) => ({
    ...app.state.tickets[0],
    id: `many-${index}`,
    number: 100 + index,
    title: `Work ${index}`,
  }));
  await page.goto("/");
  await page.getByLabel("Select all visible tickets").check();
  await expect(page.getByText("100 selected", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Select ticket SMARTSTO-200")).toBeDisabled();
  await page
    .getByRole("button", { name: "Clear selection", exact: true })
    .click();
  await page.getByRole("button", { name: "Board view", exact: true }).click();
  await page.getByLabel("Select ticket SMARTSTO-200").check();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Bulk run concurrency").selectOption("4");
  await page.getByRole("button", { name: "Run Agent", exact: true }).click();
  expect(app.writes[0].body).toMatchObject({
    ticketIds: ["many-100"],
    concurrency: 4,
  });
});

test("an unaccepted request keeps its original selection and ID for explicit retry", async ({
  page,
}) => {
  const app = await mockRecovery(page);
  app.failNextRun();
  await page.goto("/");
  await page.getByLabel("Select ticket SMARTSTO-100").check();
  await page.getByRole("button", { name: "Run Agent", exact: true }).click();
  await expect(page.getByText("Run response unavailable")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry same run request" }),
  ).toBeVisible();
  await page.getByLabel("Search tickets").fill("Invisible");
  await page.reload();
  await page.getByRole("button", { name: "Retry same run request" }).click();
  await expect(
    page.getByRole("heading", { name: "Agent run in progress" }),
  ).toBeVisible();
  const requests = app.writes.filter((item) => item.path === "/api/runs");
  expect(requests).toHaveLength(2);
  expect(requests[0].body).toEqual(requests[1].body);
});

test("takeover conflict keeps the reason visible and requires refreshed trace before retry", async ({
  page,
}) => {
  const app = await mockRecovery(page);
  app.rejectTakeover();
  await page.goto("/");
  await page
    .getByRole("button", { name: "Invisible session", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Take over prior claim", exact: true })
    .click();
  await page
    .getByLabel("Takeover reason")
    .fill("Prior session cannot be located.");
  await page
    .getByLabel(
      "I understand the prior process may still exist and will preserve its work.",
    )
    .check();
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

test("last batch tracking survives navigation and reload until explicitly dismissed", async ({
  page,
}) => {
  const app = await mockRecovery(page);
  await page.goto("/");
  await page.getByLabel("Select all visible tickets").check();
  await page.getByRole("button", { name: "Run Agent", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Agent run in progress" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.parse(
        sessionStorage.getItem("agent-desk:last-bulk-run:v1") || "null",
      ),
    ),
  ).toEqual({ id: app.writes[0].body.requestId, concurrency: 2 });
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await page.getByRole("button", { name: /^All work/ }).click();
  await expect(page.getByText("Blocker resolution queued")).toBeVisible();
  app.complete();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Agent run finished" }),
  ).toBeVisible();
  await expect(page.getByText("Checkpoint saved")).toBeVisible();
  expect(app.writes.filter((item) => item.path === "/api/runs")).toHaveLength(
    1,
  );
  await page
    .getByRole("button", { name: "Dismiss finished run", exact: true })
    .click();
  await page.reload();
  await expect(page.getByRole("heading", { name: /All work/ })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Bulk run results" }),
  ).toHaveCount(0);
});

test("accepted run with a dropped response survives reload without a second submission", async ({
  page,
}) => {
  const app = await mockRecovery(page);
  app.dropAcceptedRun();
  await page.goto("/");
  await page.getByLabel("Select ticket SMARTSTO-100").check();
  await page.getByRole("button", { name: "Run Agent", exact: true }).click();
  await expect
    .poll(() => app.writes.filter((item) => item.path === "/api/runs").length)
    .toBe(1);
  const request = app.writes[0].body;
  app.complete();
  await page.getByLabel("Search tickets").fill("Invisible");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Agent run finished" }),
  ).toBeVisible();
  await expect(page.getByText("Checkpoint saved")).toBeVisible();
  expect(app.reads()).toBeGreaterThan(0);
  expect(app.writes.filter((item) => item.path === "/api/runs")).toHaveLength(
    1,
  );
  expect(app.writes[0].body.requestId).toBe(request.requestId);
});
