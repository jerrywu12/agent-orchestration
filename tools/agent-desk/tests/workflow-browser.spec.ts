import { expect, test, type Page } from "@playwright/test";
import type { DeskState } from "../src/types";

const now = "2026-09-13T12:00:00.000Z";
const names = ["Backlog", "Ready", "In progress", "In review", "Done"];
function workspace(): DeskState {
  return {
    projects: [
      {
        id: "project",
        key: "SMARTSTO",
        name: "Workflow fixture",
        path: "/fixture/repo",
        repo: "example/fixture",
        githubProjectNumber: 1,
        statusOptions: names.map((name, i) => ({ id: `option-${i}`, name })),
      },
    ],
    stages: names.map((name, i) => ({
      id: `stage-${i}`,
      name,
      projectId: "project",
      role: ["backlog", "ready", "active", "review", "done"][
        i
      ] as DeskState["stages"][number]["role"],
      position: i,
    })),
    agents: [
      { id: "codex", name: "Codex", enabled: true, adapter: "codex" },
      { id: "claude", name: "Claude", enabled: true, adapter: "claude" },
    ],
    tickets: [
      {
        id: "ticket",
        projectId: "project",
        number: 20,
        title: "Resolve the dependency blocker",
        description: "Keep the original blocker until evidence resolves it.",
        stageId: "stage-0",
        ownerId: "codex",
        blockedReason: "Dependency needs a decision",
        dependsOn: ["dependency"],
        priority: "high",
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "dependency",
        projectId: "project",
        number: 21,
        title: "Decide the dependency",
        stageId: "stage-1",
        ownerId: "claude",
        priority: "none",
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    ],
    activity: [],
    sync: [],
    capabilities: { localMode: true },
    serverTime: now,
  };
}
function capacities() {
  return {
    refreshing: false,
    agents: [
      {
        agentId: "codex",
        status: "limited",
        ordinaryUsageAllowed: false,
        source: "Codex passive app-server",
        observedAt: "2026-09-13T11:59:00.000Z",
        stale: false,
        message: "Provider reports ordinary usage blocked.",
        windows: [
          {
            id: "weekly",
            label: "Core weekly",
            usedPercent: 94,
            remainingPercent: 6,
            resetsAt: "2026-09-14T12:00:00.000Z",
            windowMinutes: 10080,
          },
          {
            id: "five-hour",
            label: "Core five-hour",
            usedPercent: 100,
            remainingPercent: 0,
            resetsAt: "2026-09-13T11:58:00.000Z",
            windowMinutes: 300,
          },
          {
            id: "review",
            label: "Review",
            usedPercent: null,
            remainingPercent: null,
            resetsAt: null,
            windowMinutes: null,
          },
        ],
      },
      {
        agentId: "claude",
        status: "unavailable",
        source: "No passive quota integration",
        observedAt: null,
        stale: false,
        message: "Limits unavailable: no safe passive collector is configured.",
        windows: [],
      },
    ],
  };
}
async function mockWorkflow(page: Page, state = workspace()) {
  const capacity = capacities();
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const capacityReads: string[] = [];
  let quotaError = false;
  let launcherReady = true;
  await page.clock.install({ time: new Date(now) });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/state") return route.fulfill({ json: state });
    if (path === "/api/health")
      return route.fulfill({
        json: {
          status: "ok",
          root: "Workflow fixture",
          sha: "fixture",
          storage: "temporary",
          version: "test",
        },
      });
    if (path === "/api/integrations")
      return route.fulfill({
        json: {
          github: { available: true },
          agents: state.agents.map((agent) => ({
            id: agent.id,
            available: launcherReady,
            reason: launcherReady ? undefined : "Launcher executable not found",
          })),
        },
      });
    if (path.startsWith("/api/agents/status")) {
      capacityReads.push(request.method());
      if (quotaError)
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: "FIXTURE_UNAVAILABLE",
              message: "Capacity service unreachable",
            },
          },
        });
      return route.fulfill({
        status: request.method() === "POST" ? 202 : 200,
        json: capacity,
      });
    }
    if (request.method() === "GET" && path === "/api/tickets/ticket")
      return route.fulfill({
        json: { ...state.tickets[0], attachmentContext: [] },
      });
    if (request.method() === "GET" && path === "/api/projects/project")
      return route.fulfill({ json: state.projects[0] });
    if (request.method() !== "GET") {
      const body = request.postDataJSON();
      writes.push({ path, body });
      if (path === "/api/tickets/ticket/start") {
        state.tickets[0].execution = {
          id: "execution",
          ticketId: "ticket",
          agentId: "codex",
          sessionId: "fixture-resolver-session",
          state: "running",
          purpose: "resolve_blockers",
          external: false,
          heartbeatAt: now,
        } as DeskState["tickets"][number]["execution"];
        return route.fulfill({ status: 201, json: state.tickets[0].execution });
      }
      if (path === "/api/projects/project")
        Object.assign(state.projects[0], body);
      return route.fulfill({ json: state.projects[0] });
    }
    return route.fulfill({ json: [] });
  });
  return {
    state,
    capacity,
    writes,
    capacityReads,
    failCapacity: () => {
      quotaError = true;
    },
    disableLauncher: () => {
      launcherReady = false;
    },
  };
}
async function openPage(page: Page, name: "Agents" | "Settings") {
  await page.goto("/");
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}

test("workflow settings are fixed and GitHub status discovery is read-only", async ({
  page,
}) => {
  const fixture = await mockWorkflow(page);
  await openPage(page, "Settings");
  await expect(
    page.getByRole("button", { name: "Add stage", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", {
      name: /Stage name:|New stage name|GitHub status option ID/,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Stage mapping" }),
  ).toHaveCount(0);
  const workflow = page.getByRole("list", { name: "Fixed workflow stages" });
  await expect(workflow.getByRole("listitem")).toHaveCount(5);
  await expect(workflow.locator("strong")).toHaveText(names);
  await expect(
    page.getByRole("region", { name: "Discovered GitHub statuses" }),
  ).toContainText("Ready");
  await page
    .getByRole("textbox", { name: "Repository", exact: true })
    .fill("example/updated");
  await page.getByRole("button", { name: "Save project settings" }).click();
  await expect.poll(() => fixture.writes.length).toBe(1);
  expect(fixture.writes[0].body).toMatchObject({
    repo: "example/updated",
    githubProjectNumber: 1,
  });
  expect(fixture.writes[0].body).not.toHaveProperty("stageMapping");
});

test("an assigned blocked Backlog ticket can explicitly start a resolver without clearing its blocker", async ({
  page,
}) => {
  const fixture = await mockWorkflow(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: fixture.state.tickets[0].title, exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Start agent", exact: true }),
  ).toBeEnabled();
  await expect(dialog.getByText(/Start runs blocker resolution/)).toBeVisible();
  await expect(
    dialog.getByText(/does not clear blockers or dependencies automatically/),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Start agent", exact: true })
    .click();
  await expect(
    dialog.getByText("Active local session · blocker resolution", {
      exact: true,
    }),
  ).toBeVisible();
  expect(fixture.writes).toEqual([
    { path: "/api/tickets/ticket/start", body: {} },
  ]);
  expect(fixture.state.tickets[0].blockedReason).toBe(
    "Dependency needs a decision",
  );
  await expect(
    dialog.getByRole("button", { name: "Stop", exact: true }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "Copy task packet", exact: true })
    .click();
  await expect(
    dialog.getByText("Task packet copied.", { exact: true }),
  ).toBeVisible();
  await dialog.getByText("Task packet preview", { exact: true }).click();
  await expect(dialog.locator(".workflow-checklist pre")).toContainText(
    "Execution purpose: resolve_blockers",
  );
  await expect(dialog.locator(".workflow-checklist pre")).toContainText(
    "desk_get_resolution_context, desk_update_task and desk_create_subtask",
  );
  await expect(dialog.locator(".workflow-checklist pre")).toContainText(
    "Starting does not clear blockers or dependencies",
  );
});

test("capacity shows observed windows, reset times and unavailable limits separately from launchers", async ({
  page,
}) => {
  await mockWorkflow(page);
  await openPage(page, "Agents");
  const codex = page.getByRole("region", {
    name: "Provider capacity for Codex",
  });
  await expect(codex).toContainText("Capacity limited");
  await expect(codex).toContainText("94% used");
  await expect(codex).toContainText("6% remaining");
  await expect(codex).toContainText("Usage not reported");
  await expect(codex).toContainText(
    "Reset time passed; recovery not confirmed",
  );
  await expect(
    codex.locator('time[datetime="2026-09-14T12:00:00.000Z"]'),
  ).toBeVisible();
  await expect(codex).toContainText("Codex passive app-server");
  await expect(
    page.getByRole("region", { name: "Provider capacity for Claude" }),
  ).toContainText("Limits unavailable");
  await expect(page.getByText("Launcher ready", { exact: true })).toHaveCount(
    2,
  );
  await expect(page.getByText("Available", { exact: true })).toHaveCount(0);
});

test("a failed quota refresh retains observed usage and never assumes recovery from an expired reset", async ({
  page,
}) => {
  const fixture = await mockWorkflow(page);
  await openPage(page, "Agents");
  const codex = page.getByRole("region", {
    name: "Provider capacity for Codex",
  });
  await expect(codex).toContainText("94% used");
  fixture.failCapacity();
  await page
    .getByRole("button", { name: "Refresh limits", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Capacity service unreachable",
  );
  await expect(codex).toContainText("94% used");
  await expect(codex).toContainText("Stale observation");
  await expect(codex).toContainText("Capacity limited");
});

test("cached capacity polls independently of workspace refresh and stops when Agents closes", async ({
  page,
}) => {
  const fixture = await mockWorkflow(page);
  await openPage(page, "Agents");
  const codex = page.getByRole("region", {
    name: "Provider capacity for Codex",
  });
  await expect(codex).toContainText("94% used");
  await page.clock.runFor(28000);
  expect(fixture.capacityReads).toEqual(["GET"]);
  fixture.capacity.agents[0].stale = true;
  fixture.capacity.agents[0].message =
    "Provider observation could not be renewed.";
  await page.clock.runFor(3000);
  await expect(codex).toContainText("Stale observation");
  await expect(codex).toContainText(
    "Provider observation could not be renewed.",
  );
  expect(fixture.capacityReads).toEqual(["GET", "GET"]);
  await page.getByRole("button", { name: /^All work/ }).click();
  await expect(
    page.getByRole("heading", { name: /^All work \d+$/, level: 1 }),
  ).toBeVisible();
  await page.clock.runFor(60000);
  expect(fixture.capacityReads).toEqual(["GET", "GET"]);
});

test("initial capacity errors remain unavailable and an explicit refresh recovers observation", async ({
  page,
}) => {
  const fixture = await mockWorkflow(page);
  let fail = true;
  await page.route("**/api/agents/status", (route) =>
    fail
      ? route.fulfill({
          status: 503,
          json: { error: { message: "Capacity fixture offline" } },
        })
      : route.fallback(),
  );
  await openPage(page, "Agents");
  const codex = page.getByRole("region", {
    name: "Provider capacity for Codex",
  });
  await expect(page.getByRole("alert")).toContainText(
    "Capacity fixture offline",
  );
  await expect(codex).toContainText("Limits not observed");
  await expect(codex.locator("meter")).toHaveCount(0);
  fail = false;
  await page
    .getByRole("button", { name: "Refresh limits", exact: true })
    .click();
  await expect(codex).toContainText("94% used");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(fixture.capacityReads).toContain("POST");
});

for (const reason of ["backlog", "dependency", "implementation"]) {
  test(`Start describes ${reason} execution from the current saved ticket`, async ({
    page,
  }) => {
    const fixture = await mockWorkflow(page);
    fixture.state.tickets[0].blockedReason = null;
    fixture.state.tickets[0].stageId =
      reason === "backlog" ? "stage-0" : "stage-1";
    fixture.state.tickets[0].dependsOn =
      reason === "dependency" ? ["dependency"] : [];
    await page.goto("/");
    await page
      .getByRole("button", {
        name: fixture.state.tickets[0].title,
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("button", { name: "Start agent", exact: true }),
    ).toBeEnabled();
    await expect(
      dialog.getByText(
        reason === "implementation"
          ? "Explicit start · implementation"
          : "Explicit start · blocker resolution",
        { exact: true },
      ),
    ).toBeVisible();
  });
}

test("an existing external claim keeps its exact session and prevents a second Start", async ({
  page,
}) => {
  const fixture = await mockWorkflow(page);
  fixture.state.tickets[0].execution = {
    id: "held-execution",
    ticketId: "ticket",
    agentId: "codex",
    sessionId: "external-held-session",
    state: "suspended",
    external: true,
    heartbeatAt: now,
  };
  await page.goto("/");
  await page
    .getByRole("button", { name: fixture.state.tickets[0].title, exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Start agent", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Stop", exact: true }),
  ).toBeDisabled();
  await expect(dialog).toContainText("external-held-session");
  expect(fixture.writes).toHaveLength(0);
});

for (const hold of [
  "disabled",
  "unassigned",
  "archived",
  "done",
  "launcher",
  "unsaved",
]) {
  test(`explicit resolution preserves the ${hold} Start protection`, async ({
    page,
  }) => {
    const fixture = await mockWorkflow(page);
    if (hold === "disabled") fixture.state.agents[0].enabled = false;
    if (hold === "unassigned") fixture.state.tickets[0].ownerId = null;
    if (hold === "archived") fixture.state.tickets[0].archived = true;
    if (hold === "done") fixture.state.tickets[0].stageId = "stage-4";
    if (hold === "launcher") fixture.disableLauncher();
    await page.goto("/");
    if (hold === "archived") {
      await page.getByRole("button", { name: "Filters", exact: true }).click();
      await page
        .getByRole("checkbox", { name: "Archived", exact: true })
        .check();
    }
    await page
      .getByRole("button", {
        name: fixture.state.tickets[0].title,
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    if (hold === "unsaved")
      await dialog
        .getByRole("textbox", { name: "Title", exact: true })
        .fill("Edited packet");
    await expect(
      dialog.getByRole("button", { name: "Start agent", exact: true }),
    ).toBeDisabled();
    expect(fixture.writes).toHaveLength(0);
  });
}

for (const width of [320, 768, 1440]) {
  test(`provider capacity remains readable at ${width}px`, async ({ page }) => {
    await mockWorkflow(page);
    await page.setViewportSize({ width, height: 1000 });
    await openPage(page, "Agents");
    await expect(
      page.getByRole("region", { name: "Provider capacity for Codex" }),
    ).toContainText("94% used");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: test.info().outputPath("agent-capacity.png"),
      fullPage: true,
      animations: "disabled",
    });
  });
}
