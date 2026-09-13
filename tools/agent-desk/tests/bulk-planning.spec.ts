import { expect, test, type Page } from "@playwright/test";
import type { DeskState } from "../src/types";
import { randomUUID } from "node:crypto";

type Outcome = "started" | "queued" | "failed" | "refused" | "uncertain";

for (const scenario of ["failed", "started", "started-without-id"] as const) {
  const status = scenario === "failed" ? "failed" : "started";
  test(`new ${scenario} intent cannot borrow old planning execution telemetry`, async ({
    page,
  }) => {
    const app = await fixture(page);
    const ticket = app.state.tickets[0];
    ticket.stageId = "p-planning";
    ticket.launchIntent = {
      status,
      purpose: "planning",
      ownerId: "codex",
      reason:
        status === "failed"
          ? "New planner failed to launch"
          : "Waiting for new planner telemetry",
      ...(scenario === "started" ? { executionId: "new-execution" } : {}),
    };
    ticket.execution = {
      id: "old-execution",
      ticketId: ticket.id,
      agentId: "codex",
      sessionId: "old-synthetic-session",
      state: "checkpointed",
      purpose: "planning",
      summary: "Old preparation must not leak",
      progress: 100,
      releasedAt: app.state.serverTime,
    };
    await page.reload();
    const progress = page.getByRole("region", {
      name: "Planning progress",
      exact: true,
    });
    await expect(progress).toContainText(
      status === "failed" ? "Planning failed" : "Awaiting planning status",
    );
    await expect(progress).toContainText(ticket.launchIntent.reason!);
    await expect(progress).not.toContainText("Old preparation must not leak");
    await expect(progress).not.toContainText("Prepared for review");
    await expect(progress.getByRole("progressbar")).toHaveCount(0);
    expect(app.writes).toEqual([]);
  });
}

for (const heartbeat of ["missing", "stale"] as const) {
  test(`planning ${heartbeat} heartbeat cannot claim the agent is working`, async ({
    page,
  }) => {
    await page.clock.install({ time: new Date("2026-09-13T00:00:00.000Z") });
    const app = await fixture(page);
    app.state.tickets[0].stageId = "p-planning";
    app.state.tickets[0].execution = {
      id: "unverified-planner",
      ticketId: "ticket-0",
      sessionId: "synthetic-unverified",
      agentId: "codex",
      state: "running",
      purpose: "planning",
      summary: "Retained planning evidence",
      heartbeatAt: heartbeat === "stale" ? "2026-09-12T23:50:00.000Z" : null,
    };
    await page.reload();
    const progress = page.getByRole("region", {
      name: "Planning progress",
      exact: true,
    });
    await expect(progress).toContainText("Retained planning evidence");
    await expect(progress).toContainText(/needs attention/i);
    await expect(progress).not.toContainText("Planning agent working");
    expect(app.writes).toEqual([]);
  });
}

test("queued planning becomes current running telemetry on polling without starting again", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-13T00:00:00.000Z") });
  const app = await fixture(page);
  const ticket = app.state.tickets[0];
  ticket.stageId = "p-planning";
  ticket.launchIntent = {
    status: "queued",
    purpose: "planning",
    ownerId: "codex",
    reason: "Waiting for planner capacity",
  };
  ticket.execution = {
    id: "old-plan",
    ticketId: ticket.id,
    agentId: "codex",
    sessionId: "old-synthetic",
    state: "checkpointed",
    purpose: "planning",
    summary: "Old session summary",
    progress: 100,
    releasedAt: app.state.serverTime,
  };
  await page.reload();
  const progress = page.getByRole("region", {
    name: "Planning progress",
    exact: true,
  });
  await expect(progress).toContainText("Queued");
  await expect(progress).not.toContainText("Old session summary");
  ticket.version++;
  ticket.launchIntent = {
    status: "started",
    purpose: "planning",
    ownerId: "codex",
    executionId: "new-plan",
  };
  ticket.execution = {
    id: "new-plan",
    ticketId: ticket.id,
    agentId: "codex",
    sessionId: "new-synthetic",
    state: "running",
    purpose: "planning",
    summary: "Current planner developing specification",
    progress: 35,
    heartbeatAt: app.state.serverTime,
  };
  await page.clock.runFor(5000);
  await expect(progress).toContainText("Planning agent working");
  await expect(progress).toContainText(
    "Current planner developing specification",
  );
  await expect(progress.getByRole("progressbar")).toHaveAttribute(
    "value",
    "35",
  );
  await expect(progress).not.toContainText("Old session summary");
  await page.reload();
  await expect(progress).toContainText(
    "Current planner developing specification",
  );
  expect(app.writes).toEqual([]);
});

async function fixture(
  page: Page,
  outcomes: Outcome[] = ["started", "queued"],
) {
  const now = "2026-09-13T00:00:00.000Z";
  const state: DeskState = {
    projects: [
      { id: "p", key: "ONE", name: "First synthetic project" },
      { id: "q", key: "TWO", name: "Second synthetic project" },
    ],
    stages: ["p", "q"].flatMap((projectId) =>
      ["backlog", "planning", "ready", "active", "review", "done"].map(
        (role, position) => ({
          id: `${projectId}-${role}`,
          projectId,
          role: role as DeskState["stages"][number]["role"],
          name: [
            "Backlog",
            "Planning",
            "Ready",
            "In progress",
            "In review",
            "Done",
          ][position],
          position,
        }),
      ),
    ),
    agents: [
      { id: "codex", name: "Codex", adapter: "codex", enabled: true },
      { id: "claude", name: "Claude", adapter: "claude", enabled: true },
    ],
    tickets: ["p", "q"].map((projectId, i) => ({
      id: `ticket-${i}`,
      projectId,
      number: 1,
      title: `Synthetic plan ${i + 1}`,
      stageId: `${projectId}-backlog`,
      priority: "none",
      version: i + 4,
      createdAt: now,
      updatedAt: now,
    })),
    activity: [],
    sync: [],
    capabilities: { localMode: true },
    serverTime: now,
  };
  const writes: { path: string; body: any }[] = [];
  let release: (() => void) | undefined;
  let hold = false;
  let failRefresh = false;
  let available = true;
  let stateReads = 0;
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path === "/api/state") {
      stateReads++;
      return failRefresh
        ? route.fulfill({
            status: 503,
            json: { error: { message: "Synthetic refresh offline" } },
          })
        : route.fulfill({ json: state });
    }
    if (path === "/api/integrations")
      return route.fulfill({
        json: {
          github: { available: false },
          agents: state.agents.map((a) => ({
            id: a.id,
            available,
            reason: "Synthetic planner unavailable",
          })),
        },
      });
    if (request.method() !== "GET") {
      writes.push({ path, body: request.postDataJSON() });
      if (hold)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      const i = Number(path.match(/ticket-(\d+)/)?.[1]);
      const outcome = outcomes[i] || "started";
      if (outcome === "refused")
        return route.fulfill({
          status: 409,
          json: { error: { message: "Ticket version changed" } },
        });
      if (outcome === "uncertain") return route.abort("failed");
      Object.assign(state.tickets[i], {
        stageId: `${state.tickets[i].projectId}-planning`,
        ownerId: request.postDataJSON().ownerId,
        version: state.tickets[i].version + 1,
      });
      return route.fulfill({
        json: {
          ticket: state.tickets[i],
          outcome,
          reason:
            outcome === "failed"
              ? "Admitted but launcher unavailable"
              : outcome === "queued"
                ? "Waiting for planner capacity"
                : undefined,
        },
      });
    }
    const ticket = state.tickets.find((t) => path === `/api/tickets/${t.id}`);
    return route.fulfill({ json: ticket || [] });
  });
  await page.goto("/");
  return {
    state,
    writes,
    stateReads: () => stateReads,
    failRefresh: () => {
      failRefresh = true;
    },
    unavailable: () => {
      available = false;
    },
    hold: () => {
      hold = true;
    },
    release: () => {
      hold = false;
      release?.();
    },
  };
}
async function selectBoth(page: Page) {
  await page
    .getByRole("checkbox", { name: "Select ticket ONE-1", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Select ticket TWO-1", exact: true })
    .check();
}
async function dragToPlanning(page: Page) {
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  const source = page.getByRole("article", {
    name: "ONE-1 Synthetic plan 1",
    exact: true,
  });
  await expect(source).toHaveAttribute("draggable", "true");
  await source.dispatchEvent("dragstart", { dataTransfer: transfer });
  const target = page
    .getByRole("region", { name: "Planning tickets", exact: true })
    .first();
  await target.dispatchEvent("dragover", { dataTransfer: transfer });
  await target.dispatchEvent("drop", { dataTransfer: transfer });
  await source.dispatchEvent("dragend", { dataTransfer: transfer });
}

for (const view of ["List", "Board"]) {
  test(`${view} native drag gesture opens the complete selection without writing`, async ({
    page,
  }) => {
    const app = await fixture(page);
    if (view === "Board")
      await page
        .getByRole("button", { name: "Board view", exact: true })
        .click();
    await selectBoth(page);
    const source = page.getByRole("article", {
      name: "ONE-1 Synthetic plan 1",
      exact: true,
    });
    const target = page
      .getByRole("region", { name: "Planning tickets", exact: true })
      .first();
    // A List row's center is its native Stage select; drag the ticket content.
    const sourceBounds = (await source.boundingBox())!;
    const identifier = (await source.locator(".ticket-id").boundingBox())!;
    await source.dragTo(target, {
      sourcePosition: {
        x: identifier.x - sourceBounds.x + identifier.width / 2,
        y: identifier.y - sourceBounds.y + identifier.height / 2,
      },
    });
    const dialog = page.getByRole("dialog", {
      name: "Move tickets to Planning",
      exact: true,
    });
    for (const text of [
      "ONE-1",
      "TWO-1",
      "Synthetic plan 1",
      "Synthetic plan 2",
    ])
      await expect(dialog).toContainText(text);
    expect(app.writes).toEqual([]);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(app.writes).toEqual([]);
    expect(app.state.tickets.map((ticket) => ticket.stageId)).toEqual([
      "p-backlog",
      "q-backlog",
    ]);
  });
  test(`${view} drag then confirm starts or queues each selected ticket`, async ({
    page,
  }) => {
    const app = await fixture(page);
    if (view === "Board")
      await page
        .getByRole("button", { name: "Board view", exact: true })
        .click();
    await selectBoth(page);
    await dragToPlanning(page);
    const dialog = page.getByRole("dialog", {
      name: "Move tickets to Planning",
      exact: true,
    });
    expect(app.writes).toEqual([]);
    await dialog
      .getByRole("combobox", { name: "Planning agent", exact: true })
      .selectOption("claude");
    await dialog
      .getByRole("button", { name: "Confirm and start planning", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    const progress = page.getByRole("region", {
      name: "Planning progress",
      exact: true,
    });
    await expect(progress).toContainText("planning agent started");
    await expect(progress).toContainText("queued");
    expect(app.writes.map((w) => w.body)).toEqual([
      { version: 4, stageId: "p-planning", ownerId: "claude", confirmed: true },
      { version: 5, stageId: "q-planning", ownerId: "claude", confirmed: true },
    ]);
    await expect(
      page.getByRole("checkbox", { name: "Select ticket ONE-1", exact: true }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: "Select ticket TWO-1", exact: true }),
    ).not.toBeChecked();
  });
  test(`${view} selected Backlog drag lists all candidates and cancel makes zero writes`, async ({
    page,
  }) => {
    const app = await fixture(page);
    if (view === "Board")
      await page
        .getByRole("button", { name: "Board view", exact: true })
        .click();
    await selectBoth(page);
    await dragToPlanning(page);
    const dialog = page.getByRole("dialog", {
      name: "Move tickets to Planning",
      exact: true,
    });
    for (const text of [
      "ONE-1",
      "TWO-1",
      "Synthetic plan 1",
      "Synthetic plan 2",
    ])
      await expect(dialog).toContainText(text);
    await dialog
      .getByRole("combobox", { name: "Planning agent", exact: true })
      .selectOption("claude");
    expect(app.writes).toEqual([]);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(app.writes).toEqual([]);
    expect(
      app.state.tickets.map((t) => [t.stageId, t.ownerId, t.execution]),
    ).toEqual([
      ["p-backlog", undefined, undefined],
      ["q-backlog", undefined, undefined],
    ]);
  });
}

test("keyboard bulk confirmation maps each project and prevents duplicate submission", async ({
  page,
}) => {
  const app = await fixture(page);
  await selectBoth(page);
  const move = page.getByRole("button", {
    name: "Move to Planning",
    exact: true,
  });
  await move.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "Move tickets to Planning",
    exact: true,
  });
  const confirm = dialog.getByRole("button", {
    name: "Confirm and start planning",
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  await dialog
    .getByRole("combobox", { name: "Planning agent", exact: true })
    .selectOption("claude");
  app.hold();
  await confirm.click();
  await expect.poll(() => app.writes.length).toBe(1);
  await expect(dialog).not.toBeVisible();
  const progress = page.getByRole("region", {
    name: "Planning progress",
    exact: true,
  });
  await expect(progress).toContainText(/submitting|confirming/i);
  app.release();
  await expect.poll(() => app.writes.length).toBe(2);
  expect(app.writes).toEqual([
    {
      path: "/api/tickets/ticket-0/transition",
      body: {
        version: 4,
        stageId: "p-planning",
        ownerId: "claude",
        confirmed: true,
      },
    },
    {
      path: "/api/tickets/ticket-1/transition",
      body: {
        version: 5,
        stageId: "q-planning",
        ownerId: "claude",
        confirmed: true,
      },
    },
  ]);
  await expect(progress).toContainText(/started/i);
  await expect(progress).toContainText(/queued|Waiting for planner capacity/i);
  await expect(confirm).toHaveCount(0);
});

test("mixed and reserved candidates stay listed but only eligible Backlog work submits", async ({
  page,
}) => {
  const app = await fixture(page);
  app.state.tickets[1].stageId = "q-ready";
  app.state.tickets.push({
    ...app.state.tickets[0],
    id: "held",
    number: 2,
    title: "Reserved synthetic work",
    execution: {
      id: "held-execution",
      ticketId: "held",
      sessionId: "synthetic-session",
      agentId: "codex",
      state: "running",
      external: true,
    },
  });
  await page.reload();
  await selectBoth(page);
  await page
    .getByRole("checkbox", { name: "Select ticket ONE-2", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Move to Planning", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Move tickets to Planning",
    exact: true,
  });
  await expect(dialog).toContainText("TWO-1");
  await expect(dialog).toContainText("ONE-2");
  await expect(dialog).toContainText(/Backlog/);
  await expect(dialog).toContainText(/reserved|execution|claim/i);
  await dialog
    .getByRole("combobox", { name: "Planning agent", exact: true })
    .selectOption("codex");
  await dialog
    .getByRole("button", { name: "Confirm and start planning", exact: true })
    .click();
  await expect.poll(() => app.writes.length).toBe(1);
  expect(app.writes[0].path).toBe("/api/tickets/ticket-0/transition");
});

test("existing planning execution progress updates by polling and survives reload without POST", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-13T00:00:00.000Z") });
  const app = await fixture(page);
  app.state.tickets[0].stageId = "p-planning";
  app.state.tickets[0].ownerId = "codex";
  app.state.tickets[0].execution = {
    id: "planning-live",
    ticketId: "ticket-0",
    agentId: "codex",
    sessionId: "synthetic-planner",
    state: "running",
    purpose: "planning",
    summary: "Drafting specification",
    progress: 25,
    heartbeatAt: app.state.serverTime,
  };
  await page.reload();
  const progress = page.getByRole("region", {
    name: "Planning progress",
    exact: true,
  });
  await expect(progress).toContainText("Drafting specification");
  await expect(progress.getByRole("progressbar")).toHaveAttribute(
    "value",
    "25",
  );
  const priorReads = app.stateReads();
  app.state.tickets[0].execution!.summary =
    "Checking independent acceptance cases";
  app.state.tickets[0].execution!.progress = 70;
  await page.clock.runFor(16000);
  await expect.poll(() => app.stateReads()).toBeGreaterThan(priorReads);
  await expect(progress).toContainText("Checking independent acceptance cases");
  await expect(progress.getByRole("progressbar")).toHaveAttribute(
    "value",
    "70",
  );
  await page.reload();
  await expect(progress).toContainText("Checking independent acceptance cases");
  await expect(progress.getByRole("progressbar")).toHaveAttribute(
    "value",
    "70",
  );
  expect(app.writes).toEqual([]);
});

for (const scenario of [
  "running",
  "resolving",
  "checkpoint-blocked",
  "checkpoint-saved",
  "awaiting-review",
] as const) {
  test(`planning lifecycle ${scenario} reports current execution and review status`, async ({
    page,
  }) => {
    await page.clock.install({ time: new Date("2026-09-13T00:00:00.000Z") });
    const app = await fixture(page);
    const stopped =
      scenario.startsWith("checkpoint") || scenario === "awaiting-review";
    app.state.tickets[0].stageId = "p-planning";
    app.state.tickets[0].ownerId = "codex";
    app.state.tickets[0].blockedReason =
      scenario === "checkpoint-blocked" || scenario === "resolving"
        ? "Waiting for independent dependency evidence"
        : null;
    app.state.tickets[0].execution = {
      id: "planning-current",
      ticketId: "ticket-0",
      agentId: "codex",
      sessionId: "synthetic-current-planner",
      state:
        scenario === "awaiting-review"
          ? "awaiting_review"
          : stopped
            ? "checkpointed"
            : "running",
      purpose: "planning",
      summary: stopped
        ? "Planning artifacts saved with acceptance evidence"
        : "Preparing independent acceptance cases",
      heartbeatAt: app.state.serverTime,
      releasedAt: stopped ? app.state.serverTime : null,
    };
    await page.reload();
    const progress = page.getByRole("region", {
      name: "Planning progress",
      exact: true,
    });
    await expect(progress).toContainText(
      scenario === "running"
        ? "Planning agent working"
        : scenario === "resolving"
          ? "Working on blockers"
          : scenario === "checkpoint-blocked"
            ? "Needs attention"
            : scenario === "awaiting-review"
              ? "Prepared for review"
              : "Planning checkpointed",
    );
    if (stopped)
      await expect(progress).not.toContainText("Planning agent working");
    if (stopped)
      await expect(progress).toContainText(
        "Planning artifacts saved with acceptance evidence",
      );
    if (scenario === "checkpoint-saved")
      await expect(progress).not.toContainText("Prepared for review");
    await expect(progress).not.toContainText("Implementation complete");
    expect(app.writes).toEqual([]);
  });
}

for (const failure of ["refused", "uncertain", "failed"] as const) {
  test(`partial ${failure} retains per-ticket outcomes without automatic retry`, async ({
    page,
  }) => {
    const app = await fixture(page, ["started", failure]);
    await selectBoth(page);
    await page
      .getByRole("button", { name: "Move to Planning", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Move tickets to Planning",
      exact: true,
    });
    await dialog
      .getByRole("combobox", { name: "Planning agent", exact: true })
      .selectOption("codex");
    await dialog
      .getByRole("button", { name: "Confirm and start planning", exact: true })
      .click();
    await expect.poll(() => app.writes.length).toBe(2);
    await expect(dialog).not.toBeVisible();
    const progress = page.getByRole("region", {
      name: "Planning progress",
      exact: true,
    });
    await expect(progress).toContainText("ONE-1");
    await expect(progress).toContainText("TWO-1");
    await expect(progress).toContainText(
      failure === "refused"
        ? /Ticket version changed/
        : failure === "uncertain"
          ? /uncertain|inspect|verify/i
          : /Admitted but launcher unavailable/,
    );
    await expect(
      dialog.getByRole("button", {
        name: "Confirm and start planning",
        exact: true,
      }),
    ).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    expect(app.writes).toHaveLength(2);
    await expect(
      page.getByRole("checkbox", { name: "Select ticket ONE-1", exact: true }),
    ).not.toBeChecked();
    if (failure === "failed")
      await expect(
        page.getByRole("checkbox", {
          name: "Select ticket TWO-1",
          exact: true,
        }),
      ).not.toBeChecked();
    else
      await expect(
        page.getByRole("checkbox", {
          name: "Select ticket TWO-1",
          exact: true,
        }),
      ).toBeChecked();
  });
}

test("external drops and internal drops outside Planning do not open or write", async ({
  page,
}) => {
  const app = await fixture(page);
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "ticket-0");
    return data;
  });
  const target = page
    .getByRole("region", { name: "Planning tickets", exact: true })
    .first();
  await target.dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const source = page.getByRole("article", {
    name: "ONE-1 Synthetic plan 1",
    exact: true,
  });
  await source.dispatchEvent("dragstart", { dataTransfer: transfer });
  await page
    .getByRole("heading", { name: "Backlog", exact: true })
    .first()
    .dispatchEvent("drop", { dataTransfer: transfer });
  await source.dispatchEvent("dragend", { dataTransfer: transfer });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(app.writes).toEqual([]);
});

test("unselected source drag ignores the other checkbox selection", async ({
  page,
}) => {
  const app = await fixture(page);
  await page
    .getByRole("checkbox", { name: "Select ticket TWO-1", exact: true })
    .check();
  await dragToPlanning(page);
  const dialog = page.getByRole("dialog", {
    name: "Move tickets to Planning",
    exact: true,
  });
  await expect(dialog).toContainText("ONE-1");
  await expect(dialog).not.toContainText("TWO-1");
  expect(app.writes).toEqual([]);
});

test("filtered empty collapsed Planning remains a drag target", async ({
  page,
}) => {
  const app = await fixture(page);
  await page
    .getByRole("textbox", { name: "Search tickets", exact: true })
    .fill("Synthetic plan 1");
  await page
    .getByRole("button", { name: "Planning 0", exact: true })
    .first()
    .click();
  await dragToPlanning(page);
  await expect(
    page.getByRole("dialog", { name: "Move tickets to Planning", exact: true }),
  ).toContainText("ONE-1");
  expect(app.writes).toEqual([]);
});

test("a refreshed stale candidate cannot submit its unreviewed version", async ({
  page,
}) => {
  const app = await fixture(page);
  await selectBoth(page);
  await page
    .getByRole("button", { name: "Move to Planning", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Move tickets to Planning",
    exact: true,
  });
  app.state.tickets[0].version++;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(dialog).toContainText("Ticket changed");
  await dialog
    .getByRole("combobox", { name: "Planning agent", exact: true })
    .selectOption("claude");
  await dialog
    .getByRole("button", { name: "Confirm and start planning", exact: true })
    .click();
  await expect.poll(() => app.writes.length).toBe(1);
  expect(app.writes[0].path).toBe("/api/tickets/ticket-1/transition");
});

test("unavailable planner prevents confirmation", async ({ page }) => {
  const app = await fixture(page);
  app.unavailable();
  await page.reload();
  await selectBoth(page);
  await page
    .getByRole("button", { name: "Move to Planning", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Move tickets to Planning",
    exact: true,
  });
  await dialog
    .getByRole("combobox", { name: "Planning agent", exact: true })
    .selectOption("codex");
  await expect(dialog).toContainText("Synthetic planner unavailable");
  await expect(
    dialog.getByRole("button", {
      name: "Confirm and start planning",
      exact: true,
    }),
  ).toBeDisabled();
  expect(app.writes).toEqual([]);
});

test("an excluded reservation released during submission cannot join the confirmed batch", async ({
  page,
}) => {
  const app = await fixture(page);
  app.state.tickets[1].execution = {
    id: "reserved-execution",
    ticketId: "ticket-1",
    agentId: "codex",
    sessionId: "synthetic-reservation",
    state: "running",
    external: true,
  };
  await page.reload();
  await selectBoth(page);
  await page
    .getByRole("button", { name: "Move to Planning", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Move tickets to Planning",
    exact: true,
  });
  await expect(dialog).toContainText("1 eligible · 1 will not move");
  await expect(dialog).toContainText("An existing execution owns this ticket");
  await dialog
    .getByRole("combobox", { name: "Planning agent", exact: true })
    .selectOption("codex");
  app.hold();
  await dialog
    .getByRole("button", { name: "Confirm and start planning", exact: true })
    .click();
  await expect.poll(() => app.writes.length).toBe(1);
  const priorReads = app.stateReads();
  app.state.tickets[1].execution = null;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => app.stateReads()).toBeGreaterThan(priorReads);
  // Prove the refreshed state reached React while the first transition remains held.
  await expect(
    page.getByRole("article", { name: "TWO-1 Synthetic plan 2", exact: true }),
  ).not.toContainText("External session");
  app.release();
  const progress = page.getByRole("region", {
    name: "Planning progress",
    exact: true,
  });
  await expect(progress).toContainText(
    "Not moved: An existing execution owns this ticket",
  );
  expect(app.writes).toHaveLength(1);
  await expect(progress).toContainText(
    "Not moved: An existing execution owns this ticket",
  );
  expect(app.state.tickets[1].stageId).toBe("q-backlog");
});

test("completed outcomes survive board refresh failure without replay", async ({
  page,
}) => {
  const app = await fixture(page);
  await selectBoth(page);
  await page
    .getByRole("button", { name: "Move to Planning", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Move tickets to Planning",
    exact: true,
  });
  await dialog
    .getByRole("combobox", { name: "Planning agent", exact: true })
    .selectOption("codex");
  app.failRefresh();
  await dialog
    .getByRole("button", { name: "Confirm and start planning", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const progress = page.getByRole("region", {
    name: "Planning progress",
    exact: true,
  });
  await expect(progress).toContainText("planning agent started");
  await expect(progress).toContainText("queued");
  await expect(progress).toContainText(/could not refresh|refresh.*failed/i);
  expect(app.writes).toHaveLength(2);
  await expect(
    dialog.getByRole("button", {
      name: "Confirm and start planning",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("real isolated API retains both Backlog tickets and history when bulk confirmation is cancelled", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/projects", {
    data: {
      name: `Bulk cancel ${randomUUID()}`,
      key: `B${randomUUID().slice(0, 7)}`,
    },
  });
  expect(created.status()).toBe(201);
  const project = await created.json();
  const snapshot = await (await request.get("/api/state")).json();
  const backlog = snapshot.stages.find(
    (stage: any) => stage.projectId === project.id && stage.role === "backlog",
  );
  const tickets = [];
  for (let i = 0; i < 2; i++) {
    const response = await request.post("/api/tickets", {
      data: {
        projectId: project.id,
        stageId: backlog.id,
        title: `Synthetic cancellation ${i}`,
      },
    });
    expect(response.status()).toBe(201);
    tickets.push(await response.json());
  }
  await page.route("**/api/integrations", (route) =>
    route.fulfill({
      json: {
        github: { available: false },
        agents: [{ id: "codex", available: true }],
      },
    }),
  );
  const writes: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/") && req.method() !== "GET")
      writes.push(req.url());
  });
  await page.goto("/");
  for (const ticket of tickets)
    await page
      .getByRole("checkbox", {
        name: `Select ticket ${project.key}-${ticket.number}`,
        exact: true,
      })
      .check();
  await page
    .getByRole("button", { name: "Move to Planning", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Move tickets to Planning",
    exact: true,
  });
  await dialog
    .getByRole("combobox", { name: "Planning agent", exact: true })
    .selectOption("codex");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(writes).toEqual([]);
  for (const before of tickets) {
    const after = await (await request.get(`/api/tickets/${before.id}`)).json();
    for (const key of [
      "stageId",
      "ownerId",
      "version",
      "stageHistory",
      "stageChangedAt",
      "execution",
    ])
      expect(after[key]).toEqual(before[key]);
  }
});
