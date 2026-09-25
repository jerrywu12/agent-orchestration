import { expect, test, type Page } from "@playwright/test";
import type { DeskState } from "../src/types";

const now = "2026-09-13T12:00:00.000Z";
const names = ["Backlog", "Planning", "Ready", "In progress", "In review", "Done"];
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
      role: ["backlog", "planning", "ready", "active", "review", "done"][
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
        stageId: "stage-2",
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
  await expect(workflow.getByRole("listitem")).toHaveCount(6);
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

test("an assigned blocked Backlog ticket keeps its blocker without launch controls", async ({ page }) => {
  const fixture = await mockWorkflow(page);
  await page.goto("/");
  await page.getByRole("button", { name: fixture.state.tickets[0].title, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Start agent", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Copy task packet", exact: true })).toHaveCount(0);
  await dialog.locator("summary").filter({ hasText: "Relationships & blockers" }).click();
  await expect(dialog.getByLabel("Blocker", { exact: true })).toHaveValue("Dependency needs a decision");
  expect(fixture.state.tickets[0].dependsOn).toEqual(["dependency"]);
  expect(fixture.writes).toEqual([]);
  await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByLabel("Select ticket SMARTSTO-20").check();
  await expect(page.getByRole("button", { name: "Run Agent", exact: true })).toHaveCount(0);
});

test("capacity shows observed windows and unavailable limits alongside reporting status", async ({
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
  await expect(page.getByText("Reporting enabled", { exact: true })).toHaveCount(
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
  test(`the ${reason} ticket drawer does not expose agent execution details`, async ({ page }) => {
    const fixture = await mockWorkflow(page);
    fixture.state.tickets[0].blockedReason = null;
    fixture.state.tickets[0].stageId = reason === "backlog" ? "stage-0" : "stage-2";
    fixture.state.tickets[0].dependsOn = reason === "dependency" ? ["dependency"] : [];
    await page.goto("/");
    await page.getByRole("button", { name: fixture.state.tickets[0].title, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Start agent", exact: true })).toHaveCount(0);
    await expect(dialog.getByText(/Explicit start/)).toHaveCount(0);
    await expect(dialog.getByRole("combobox", { name: "Stage", exact: true })).toHaveValue(fixture.state.tickets[0].stageId);
    expect(fixture.writes).toEqual([]);
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
  ).toHaveCount(0);
  await expect(dialog).not.toContainText("external-held-session");
  expect(fixture.state.tickets[0].execution?.sessionId).toBe("external-held-session");
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
  test(`the ${hold} drawer cannot dispatch an agent`, async ({
    page,
  }) => {
    const fixture = await mockWorkflow(page);
    if (hold === "disabled") fixture.state.agents[0].enabled = false;
    if (hold === "unassigned") fixture.state.tickets[0].ownerId = null;
    if (hold === "archived") fixture.state.tickets[0].archived = true;
    if (hold === "done") fixture.state.tickets[0].stageId = "stage-5";
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
    ).toHaveCount(0);
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
  });
}

for (const external of [true, false]) {
  test(`running ${external ? "external" : "managed"} execution keeps state when heartbeat is overdue`, async ({ page }) => {
    const state = workspace();
    const ticket = state.tickets[0];
    ticket.stageId = "stage-3";
    ticket.blockedReason = "";
    ticket.execution = {
      id: "execution", ticketId: ticket.id, agentId: "codex",
      sessionId: "active-native-session", state: "running", external,
      heartbeatAt: "2026-09-13T11:49:00.000Z",
    };
    const mock = await mockWorkflow(page, state);
    await page.goto("/");
    for (const view of ["List view", "Board view"]) {
      await page.getByRole("button", { name: view, exact: true }).click();
      const badge = page.locator('[data-execution-status="running"]');
      await expect(badge).toContainText("Running");
      await expect(badge).toContainText("Heartbeat overdue");
      await expect(badge).toHaveAttribute("title", /Last reported state: running/);
      await expect(badge).toHaveAttribute("title", /does not mean the session stopped/);
      await expect(page.getByText("Stale", { exact: true })).toHaveCount(0);
    }
    expect(mock.writes).toEqual([]);
  });
}

for (const scenario of [
  { name: "fresh", heartbeatAt: now, state: "running", overdue: false },
  { name: "missing", heartbeatAt: undefined, state: "running", overdue: true },
  { name: "invalid", heartbeatAt: "invalid", state: "running", overdue: true },
  { name: "suspended", heartbeatAt: now, state: "suspended", overdue: false },
  { name: "released", heartbeatAt: now, state: "running", overdue: false, releasedAt: now },
]) {
  test(`execution badge handles ${scenario.name} reporting without inventing activity`, async ({ page }) => {
    const state = workspace();
    const ticket = state.tickets[0];
    ticket.execution = {
      id: "execution", ticketId: ticket.id, agentId: "codex",
      sessionId: "retained-session", external: true,
      state: scenario.state, heartbeatAt: scenario.heartbeatAt,
      releasedAt: scenario.releasedAt,
    };
    const mock = await mockWorkflow(page, state);
    await page.goto("/");
    for (const view of ["List view", "Board view"]) {
      await page.getByRole("button", { name: view, exact: true }).click();
      const badge = page.locator("[data-execution-status]");
      if (scenario.releasedAt) {
        await expect(badge).toHaveCount(0);
      } else {
        await expect(badge).toHaveAttribute("data-execution-status", scenario.state);
        await expect(badge).toContainText(scenario.state === "suspended" ? "Suspended" : "Running");
        if (scenario.overdue) await expect(badge).toContainText("Heartbeat overdue");
        else await expect(badge).not.toContainText("Heartbeat overdue");
      }
    }
    expect(mock.writes).toEqual([]);
  });
}
