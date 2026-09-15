import { expect, test, type Page } from "@playwright/test";
import type { ActivitySnapshot } from "../src/activity-types";
import type { MachineSnapshot } from "../src/machine-types";
import type { DeskState } from "../src/types";

const observedAt = "2026-09-15T09:14:02.411Z";

const desk: DeskState = {
  projects: [{ id: "fixture-project", name: "Fixture workspace", key: "FIX" }],
  stages: [
    {
      id: "fixture-stage",
      projectId: "fixture-project",
      name: "Planning",
      role: "planning",
      position: 0,
    },
  ],
  agents: [
    {
      id: "codex",
      name: "Codex",
      adapter: "codex",
      enabled: true,
      color: "#315942",
    },
  ],
  tickets: [],
  activity: [],
  sync: [],
  capabilities: { localMode: true },
  serverTime: observedAt,
};

function machineInventory(): MachineSnapshot {
  return {
    host: {
      name: "Fixture Mac",
      platform: "darwin",
      arch: "arm64",
      memoryTotalBytes: 32 * 1024 ** 3,
      memoryFreeBytes: 8 * 1024 ** 3,
      loadAverage: [1.2, 0.8, 0.6],
      uptimeSeconds: 176400,
    },
    agents: [],
    libraries: [],
    sources: [],
    services: [],
    customSources: [],
    scan: {
      state: "idle",
      inventoryAt: observedAt,
      runtimeAt: observedAt,
      error: null,
      runtimeError: null,
      issues: [],
      truncated: false,
    },
    limits: {
      inventoryIntervalMs: 300000,
      runtimeIntervalMs: 15000,
      maxCustomSources: 20,
    },
  };
}

function activeSnapshot(): ActivitySnapshot {
  return {
    activeCount: 3,
    state: "active",
    tasks: [
      {
        id: "019f4b72",
        agentId: "codex",
        origin: "Subagent",
        description: "Reconcile planning stage transitions",
        workspace: "agent-orchestrator",
        lifecycle: "active",
      },
    ],
    workers: [
      {
        agentId: "claude",
        agentName: "Claude Code",
        pid: 45012,
        elapsedSeconds: 1874,
      },
      {
        agentId: "agy",
        agentName: "Antigravity CLI",
        pid: 45330,
        elapsedSeconds: 96,
      },
    ],
    sleepPrevention: {
      state: "active",
      holders: [{ pid: 2195, elapsedSeconds: 46709 }],
    },
    sources: [
      {
        id: "codex-tasks",
        label: "Codex tasks",
        status: "observed",
        reason: null,
        retained: false,
      },
      {
        id: "processes",
        label: "Processes",
        status: "observed",
        reason: null,
        retained: false,
      },
    ],
    observedAt,
    stale: false,
    partial: false,
    truncated: false,
    refreshing: false,
    notes: [],
  };
}

function idleSnapshot(): ActivitySnapshot {
  return {
    activeCount: 0,
    state: "idle",
    tasks: [],
    workers: [],
    sleepPrevention: { state: "inactive", holders: [] },
    sources: [
      {
        id: "codex-tasks",
        label: "Codex tasks",
        status: "observed",
        reason: null,
        retained: false,
      },
      {
        id: "processes",
        label: "Processes",
        status: "observed",
        reason: null,
        retained: false,
      },
    ],
    observedAt,
    stale: false,
    partial: false,
    truncated: false,
    refreshing: false,
    notes: [],
  };
}

function unobservableSnapshot(): ActivitySnapshot {
  return {
    activeCount: 0,
    state: "unobservable",
    tasks: [],
    workers: [],
    sleepPrevention: { state: "unobservable", holders: [] },
    sources: [
      {
        id: "codex-tasks",
        label: "Codex tasks",
        status: "unobservable",
        reason:
          "The Codex task source uses an unrecognized format and was not read.",
        retained: false,
      },
      {
        id: "processes",
        label: "Processes",
        status: "unobservable",
        reason: "Process table could not be observed on this platform.",
        retained: false,
      },
    ],
    observedAt,
    stale: false,
    partial: false,
    truncated: false,
    refreshing: false,
    notes: [
      "Activity cannot be confirmed; one or more activity sources could not be read.",
    ],
  };
}

async function setupPageRoutes(page: Page, activity: ActivitySnapshot) {
  let currentActivity = activity;
  let refreshCalls = 0;

  await page.route("**/api/state", (route) => route.fulfill({ json: desk }));
  await page.route("**/api/integrations", (route) =>
    route.fulfill({ json: { github: { available: false }, agents: [] } }),
  );
  await page.route("**/api/machine**", (route) =>
    route.fulfill({ json: machineInventory() }),
  );

  await page.route("**/api/activity**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === "/api/activity/refresh" && req.method() === "POST") {
      refreshCalls += 1;
      return route.fulfill({ status: 202, json: currentActivity });
    }
    if (url.pathname === "/api/activity" && req.method() === "GET") {
      return route.fulfill({ status: 200, json: currentActivity });
    }
    return route.fulfill({ status: 404, json: { error: "Not found" } });
  });

  return {
    setActivity: (next: ActivitySnapshot) => {
      currentActivity = next;
    },
    getRefreshCalls: () => refreshCalls,
  };
}

async function openMachine(page: Page) {
  await page.goto("/");
  const menu = page.getByRole("button", {
    name: "Open navigation",
    exact: true,
  });
  if (await menu.isVisible()) await menu.click();
  await expect(
    page.getByRole("button", { name: "Machine", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Machine", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Machine", exact: true }),
  ).toBeVisible();
}

test.describe("Agent Activity Browser Specs", () => {
  test("active state renders tasks, workers, and count with distinct DOM structure", async ({
    page,
  }) => {
    await setupPageRoutes(page, activeSnapshot());
    await openMachine(page);

    const section = page.locator(".activity-section");
    await expect(section).toBeVisible();
    await expect(section).toHaveAttribute("data-activity-state", "active");

    // Structural DOM presence: tasks and workers containers exist
    const tasksContainer = page.locator('[data-testid="activity-tasks"]');
    const workersContainer = page.locator('[data-testid="activity-workers"]');
    await expect(tasksContainer).toBeVisible();
    await expect(workersContainer).toBeVisible();

    // Idle and unobservable structural containers must NOT exist
    await expect(page.locator('[data-testid="activity-idle"]')).toHaveCount(0);
    await expect(
      page.locator('[data-testid="activity-unobservable"]'),
    ).toHaveCount(0);

    // Verify task row details
    await expect(page.locator('[data-testid="activity-count"]')).toContainText(
      "3 active",
    );
    const taskRow = page.locator('[data-testid="activity-task-019f4b72"]');
    await expect(taskRow).toBeVisible();
    await expect(taskRow.locator(".activity-id-tag")).toHaveText("019f4b72");
    await expect(taskRow.locator(".activity-origin-tag")).toHaveText("Subagent");
    await expect(taskRow.locator(".activity-description-text")).toHaveText(
      "Reconcile planning stage transitions",
    );
    await expect(taskRow.locator(".activity-workspace-tag")).toHaveText(
      "agent-orchestrator",
    );
    await expect(taskRow.locator(".activity-lifecycle-tag")).toHaveText(
      "active",
    );

    // Verify worker row details
    const claudeWorker = page.locator('[data-testid="activity-worker-45012"]');
    await expect(claudeWorker).toBeVisible();
    await expect(claudeWorker.locator(".activity-agent-name")).toContainText(
      "Claude Code",
    );
    await expect(claudeWorker.locator(".activity-elapsed-badge")).toContainText(
      "31m 14s",
    );

    const agyWorker = page.locator('[data-testid="activity-worker-45330"]');
    await expect(agyWorker).toBeVisible();
    await expect(agyWorker.locator(".activity-agent-name")).toContainText(
      "Antigravity CLI",
    );
    await expect(agyWorker.locator(".activity-elapsed-badge")).toContainText(
      "1m 36s",
    );
  });

  test("idle state renders distinct empty container without task/worker tables", async ({
    page,
  }) => {
    await setupPageRoutes(page, idleSnapshot());
    await openMachine(page);

    const section = page.locator(".activity-section");
    await expect(section).toBeVisible();
    await expect(section).toHaveAttribute("data-activity-state", "idle");

    // Structural DOM presence: idle container exists
    const idleContainer = page.locator('[data-testid="activity-idle"]');
    await expect(idleContainer).toBeVisible();
    await expect(idleContainer).toContainText(
      "No active agent tasks or background workers",
    );

    // Count indicates 0
    await expect(page.locator('[data-testid="activity-count"]')).toContainText(
      "0 active",
    );

    // Structural DOM absence: task table, worker table, unobservable banner do NOT exist
    await expect(page.locator('[data-testid="activity-tasks"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="activity-workers"]')).toHaveCount(
      0,
    );
    await expect(
      page.locator('[data-testid="activity-unobservable"]'),
    ).toHaveCount(0);
  });

  test("unobservable state renders distinct unobservable container with reasons", async ({
    page,
  }) => {
    await setupPageRoutes(page, unobservableSnapshot());
    await openMachine(page);

    const section = page.locator(".activity-section");
    await expect(section).toBeVisible();
    await expect(section).toHaveAttribute("data-activity-state", "unobservable");

    // Structural DOM presence: unobservable container exists
    const unobservableContainer = page.locator(
      '[data-testid="activity-unobservable"]',
    );
    await expect(unobservableContainer).toBeVisible();
    await expect(unobservableContainer).toContainText(
      "Activity cannot be confirmed",
    );

    // Unobservable source reasons list is present
    const reasonsList = page.locator(
      '[data-testid="activity-unobservable-reasons"]',
    );
    await expect(reasonsList).toBeVisible();
    await expect(reasonsList).toContainText(
      "The Codex task source uses an unrecognized format and was not read.",
    );

    // Structural DOM absence: idle state container does NOT exist
    await expect(page.locator('[data-testid="activity-idle"]')).toHaveCount(0);
  });

  test("stale indicator renders when snapshot is stale and is absent when fresh", async ({
    page,
  }) => {
    const staleData = activeSnapshot();
    staleData.stale = true;

    const controller = await setupPageRoutes(page, staleData);
    await openMachine(page);

    // Stale indicator is visible in the DOM
    const staleIndicator = page.locator('[data-testid="activity-stale"]');
    await expect(staleIndicator).toBeVisible();
    await expect(staleIndicator).toContainText("Observation is stale");
    await expect(page.locator(".activity-section")).toHaveAttribute(
      "data-activity-stale",
      "true",
    );

    // Update to fresh snapshot
    const freshData = activeSnapshot();
    freshData.stale = false;
    controller.setActivity(freshData);

    // Click refresh to reload
    await page.getByRole("button", { name: "Refresh activity" }).click();

    // Stale indicator should no longer be present
    await expect(page.locator('[data-testid="activity-stale"]')).toHaveCount(0);
    await expect(page.locator(".activity-section")).toHaveAttribute(
      "data-activity-stale",
      "false",
    );
  });

  test("partial-coverage indicator renders when snapshot has partial coverage", async ({
    page,
  }) => {
    const partialData: ActivitySnapshot = {
      activeCount: 1,
      state: "unobservable",
      tasks: [],
      workers: [
        {
          agentId: "claude",
          agentName: "Claude Code",
          pid: 45012,
          elapsedSeconds: 1874,
        },
      ],
      sleepPrevention: { state: "inactive", holders: [] },
      sources: [
        {
          id: "codex-tasks",
          label: "Codex tasks",
          status: "unobservable",
          reason:
            "The Codex task source uses an unrecognized format and was not read.",
          retained: false,
        },
        {
          id: "processes",
          label: "Processes",
          status: "observed",
          reason: null,
          retained: false,
        },
      ],
      observedAt,
      stale: false,
      partial: true,
      truncated: false,
      refreshing: false,
      notes: [
        "Codex task activity is unavailable; the count reflects processes only.",
      ],
    };

    await setupPageRoutes(page, partialData);
    await openMachine(page);

    // Partial indicator is structurally visible
    const partialIndicator = page.locator('[data-testid="activity-partial"]');
    await expect(partialIndicator).toBeVisible();
    await expect(partialIndicator).toContainText("Partial source coverage");
    await expect(page.locator(".activity-section")).toHaveAttribute(
      "data-activity-partial",
      "true",
    );

    // Even with partial tasks unobservable, fallback workers are rendered
    await expect(
      page.locator('[data-testid="activity-workers"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="activity-worker-45012"]'),
    ).toBeVisible();

    // Notes list is displayed
    await expect(page.locator('[data-testid="activity-notes"]')).toContainText(
      "Codex task activity is unavailable; the count reflects processes only.",
    );
  });
});
