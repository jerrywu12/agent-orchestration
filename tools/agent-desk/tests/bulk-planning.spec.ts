import { expect, test, type Page } from "@playwright/test";
import type { DeskState } from "../src/types";
import { randomUUID } from "node:crypto";

type Outcome = "started" | "queued" | "failed" | "refused" | "uncertain";

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
    await expect(dialog).toContainText("planning agent started");
    await expect(dialog).toContainText("queued");
    expect(app.writes.map((w) => w.body)).toEqual([
      { version: 4, stageId: "p-planning", ownerId: "claude", confirmed: true },
      { version: 5, stageId: "q-planning", ownerId: "claude", confirmed: true },
    ]);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
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
  await expect(confirm).toBeDisabled();
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
  await expect(dialog).toContainText(/started/i);
  await expect(dialog).toContainText(/queued|Waiting for planner capacity/i);
  await expect(confirm).toBeDisabled();
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
    await expect(dialog).toContainText("ONE-1");
    await expect(dialog).toContainText("TWO-1");
    await expect(dialog).toContainText(
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
    ).toBeDisabled();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    expect(app.writes).toHaveLength(2);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
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
  await expect(dialog).toContainText("Planning requests finished");
  expect(app.writes).toHaveLength(1);
  await expect(dialog).toContainText(
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
  await expect(dialog).toContainText("planning agent started");
  await expect(dialog).toContainText("queued");
  await expect(dialog).toContainText(/could not refresh|refresh.*failed/i);
  expect(app.writes).toHaveLength(2);
  await expect(
    dialog.getByRole("button", {
      name: "Confirm and start planning",
      exact: true,
    }),
  ).toBeDisabled();
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
