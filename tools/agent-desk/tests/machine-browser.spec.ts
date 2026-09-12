import { expect, test, type Page } from "@playwright/test";
import type { MachineSnapshot } from "../src/machine-types";
import type { DeskState } from "../src/types";

const observedAt = "2026-09-13T09:00:00.000Z";
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
  tickets: [
    {
      id: "fixture-ticket",
      projectId: "fixture-project",
      number: 1,
      title: "Preserve this reserved ticket",
      stageId: "fixture-stage",
      ownerId: "codex",
      priority: "high",
      version: 1,
      createdAt: observedAt,
      updatedAt: observedAt,
      execution: {
        id: "fixture-execution",
        ticketId: "fixture-ticket",
        agentId: "codex",
        sessionId: "fixture-session",
        state: "external",
        external: true,
        heartbeatAt: observedAt,
        releasedAt: null,
      },
    },
  ],
  activity: [],
  sync: [],
  capabilities: { localMode: true },
  serverTime: observedAt,
};

function inventory(): MachineSnapshot {
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
    agents: [
      {
        id: "codex-cli",
        name: "Codex CLI",
        kind: "agent",
        installed: true,
        version: "1.2.3",
        path: "/fixture/bin/codex",
        deskAgentId: "codex",
        status: "running",
        processes: [
          { pid: 4242, cpuPercent: 3.5, memoryBytes: 128 * 1024 ** 2 },
        ],
        cpuPercent: 3.5,
        memoryBytes: 128 * 1024 ** 2,
      },
      {
        id: "uv",
        name: "uv",
        kind: "tool",
        installed: true,
        version: "0.8.0",
        path: "/fixture/bin/uv",
        status: "idle",
        processes: [],
        cpuPercent: 0,
        memoryBytes: 0,
      },
      {
        id: "hermes",
        name: "Hermes",
        kind: "agent",
        installed: false,
        version: null,
        path: null,
        status: "unknown",
        processes: [],
        cpuPercent: null,
        memoryBytes: null,
      },
    ],
    libraries: [
      ...Array.from({ length: 55 }, (_, index) => ({
        id: `npm-${index}`,
        name: `fixture-package-${String(index).padStart(2, "0")}`,
        version: "1.0.0",
        ecosystem: "npm" as const,
        sourceId: "global-npm",
        status: "installed" as const,
        path: `/fixture/npm/fixture-package-${index}`,
      })),
      {
        id: "declared-python",
        name: "fixture-research",
        version: null,
        requestedVersion: ">=2.1",
        ecosystem: "python",
        sourceId: "project-source",
        status: "declared",
        path: "/fixture/project/pyproject.toml",
      },
      {
        id: "cached-plugin",
        name: "fixture-browser-plugin",
        version: "0.1.0",
        ecosystem: "plugin",
        sourceId: "plugin-cache",
        status: "cached",
        path: "/fixture/plugins/browser/.codex-plugin/plugin.json",
      },
    ],
    sources: [
      {
        id: "global-npm",
        label: "Global npm",
        path: "/fixture/npm",
        kind: "npm",
        status: "scanned",
        packageCount: 55,
      },
      {
        id: "project-source",
        label: "Fixture project",
        path: "/fixture/project",
        kind: "project",
        status: "partial",
        packageCount: 1,
        detail:
          "Dependency declarations found; installed environment unavailable.",
      },
      {
        id: "missing-python",
        label: "Optional Python environment",
        path: "/fixture/missing",
        kind: "python",
        status: "missing",
        packageCount: 0,
        detail: "Directory not present.",
      },
      {
        id: "plugin-cache",
        label: "Plugin cache",
        path: "/fixture/plugins",
        kind: "tools",
        status: "scanned",
        packageCount: 1,
        detail: "Cached manifests do not establish installation or enablement.",
      },
    ],
    services: [
      {
        id: "ollama",
        name: "Ollama",
        endpoint: "http://127.0.0.1:11434",
        status: "healthy",
        latencyMs: 12,
        detail: "Endpoint responded.",
      },
      {
        id: "deerflow",
        name: "DeerFlow",
        endpoint: "http://127.0.0.1:8001/health",
        status: "unreachable",
        latencyMs: null,
        detail: "Endpoint did not respond before the deadline.",
      },
    ],
    customSources: [],
    scan: {
      state: "idle",
      inventoryAt: observedAt,
      runtimeAt: observedAt,
      error: null,
      runtimeError: null,
      issues: ["Generic Node processes were not attributed to an agent."],
      truncated: false,
    },
    limits: {
      inventoryIntervalMs: 300000,
      runtimeIntervalMs: 15000,
      maxCustomSources: 20,
    },
  };
}

async function fixture(
  page: Page,
  initial = inventory(),
  initialResponseDelayMs = 0,
) {
  let current = initial;
  let disconnected = false;
  let reads = 0;
  const mutations: { path: string; method: string; body: unknown }[] = [];
  await page.route("**/api/state", (route) => route.fulfill({ json: desk }));
  await page.route("**/api/integrations", (route) =>
    route.fulfill({ json: { github: { available: false }, agents: [] } }),
  );
  await page.route("**/api/machine**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/machine" && request.method() === "GET") {
      reads += 1;
      const observed = current;
      if (reads === 1 && initialResponseDelayMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, initialResponseDelayMs),
        );
      }
      if (disconnected)
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: "FIXTURE_OFFLINE",
              message: "Fixture machine service is disconnected.",
            },
          },
        });
      return route.fulfill({ json: observed });
    }
    const body = request.postData() ? request.postDataJSON() : null;
    mutations.push({ path, method: request.method(), body });
    if (path === "/api/machine/refresh")
      return route.fulfill({
        status: 202,
        json: { ...current, scan: { ...current.scan, state: "scanning" } },
      });
    if (path === "/api/machine/sources" && request.method() === "POST") {
      if (!body.path.startsWith("/fixture/"))
        return route.fulfill({
          status: 422,
          json: {
            error: {
              code: "INVALID_SOURCE",
              message: "Choose an existing absolute directory.",
            },
          },
        });
      const source = {
        id: `custom-${current.customSources.length + 1}`,
        label: body.label || "Custom folder",
        path: body.path,
      };
      current = {
        ...current,
        customSources: [...current.customSources, source],
      };
      return route.fulfill({ status: 201, json: source });
    }
    if (
      path.startsWith("/api/machine/sources/") &&
      request.method() === "DELETE"
    ) {
      current = {
        ...current,
        customSources: current.customSources.filter(
          (source) => source.id !== path.split("/").at(-1),
        ),
      };
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({
      status: 404,
      json: {
        error: {
          code: "FIXTURE_ROUTE",
          message: "Unexpected fixture request.",
        },
      },
    });
  });
  return {
    set: (value: MachineSnapshot) => {
      current = value;
    },
    offline: (value: boolean) => {
      disconnected = value;
    },
    reads: () => reads,
    mutations,
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

test("machine inventory separates installation, observed runtime, health and reserved work", async ({
  page,
}) => {
  await fixture(page);
  await openMachine(page);
  await expect(page.getByText("Fixture Mac", { exact: true })).toBeVisible();
  const codex = page.getByRole("row").filter({
    has: page.getByRole("button", { name: "Inspect Codex CLI", exact: true }),
  });
  await expect(codex).toContainText("Installed");
  await expect(codex).toContainText("Running");
  await expect(codex).toContainText("1 reserved");
  const uv = page.getByRole("row").filter({
    has: page.getByRole("button", { name: "Inspect uv", exact: true }),
  });
  await expect(uv).toContainText("No matched process");
  await expect(
    page.getByRole("row").filter({
      has: page.getByRole("button", { name: "Inspect Hermes", exact: true }),
    }),
  ).toContainText("Not found");
  await expect(
    page.getByRole("row").filter({ hasText: "DeerFlow" }),
  ).toContainText("Unreachable");
  await expect(
    page.getByText(/Endpoint responsiveness does not verify/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Inspect Codex CLI", exact: true })
    .click();
  await expect(
    page.getByText("/fixture/bin/codex", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("4242", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: /Preserve this reserved ticket/ })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Title", { exact: true }),
  ).toHaveValue("Preserve this reserved ticket");
});

test("library filters and bounded pagination distinguish installed packages from declarations", async ({
  page,
}) => {
  await fixture(page);
  await openMachine(page);
  await page.getByRole("tab", { name: /^Libraries/ }).click();
  await expect(page.locator(".machine-library-row")).toHaveCount(25);
  await expect(page.getByText("1–25 of 57", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Next library page", exact: true })
    .click();
  await expect(page.getByText("26–50 of 57", { exact: true })).toBeVisible();
  await page
    .getByRole("combobox", { name: "Library ecosystem", exact: true })
    .selectOption("python");
  await expect(page.locator(".machine-library-row")).toHaveCount(1);
  await expect(
    page.getByText("fixture-research", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(">=2.1", { exact: true })).toBeVisible();
  await page
    .getByRole("combobox", { name: "Library status", exact: true })
    .selectOption("installed");
  await expect(
    page.getByRole("heading", { name: "No matching libraries", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear library filters", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Library source", exact: true })
    .selectOption("global-npm");
  await page
    .getByRole("searchbox", { name: "Search libraries", exact: true })
    .fill("fixture-package-54");
  await expect(page.locator(".machine-library-row")).toHaveCount(1);
  await expect(
    page.getByText("fixture-package-54", { exact: true }),
  ).toBeVisible();
});

test("cached plugin metadata remains distinct from installed libraries", async ({
  page,
}) => {
  await fixture(page);
  await openMachine(page);
  await page.getByRole("tab", { name: /^Libraries/ }).click();
  await page
    .getByRole("combobox", { name: "Library source", exact: true })
    .selectOption("plugin-cache");
  const row = page.locator(".machine-library-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Cached");
  await expect(row).not.toContainText("Installed");
  await expect(row).toContainText("Plugin");
  await expect(row).toContainText("0.1.0");
  await page
    .getByRole("combobox", { name: "Library ecosystem", exact: true })
    .selectOption("plugin");
  await page
    .getByRole("combobox", { name: "Library status", exact: true })
    .selectOption("cached");
  await expect(row).toHaveCount(1);
  await page
    .getByRole("button", { name: "fixture-browser-plugin", exact: true })
    .click();
  await expect(
    page.getByText(/Cached metadata does not establish installation/),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Library status", exact: true })
    .selectOption("installed");
  await expect(
    page.getByRole("heading", { name: "No matching libraries", exact: true }),
  ).toBeVisible();
});

test("coverage and custom folders remain explicit and source configuration survives navigation", async ({
  page,
}) => {
  const mocked = await fixture(page);
  await openMachine(page);
  await page.getByRole("tab", { name: /^Sources/ }).click();
  await expect(
    page.getByText("Directory not present.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Dependency declarations found; installed environment unavailable.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Folder path", exact: true })
    .fill("/fixture/additional");
  await page
    .getByRole("textbox", { name: "Folder label", exact: true })
    .fill("Additional tooling");
  await page.getByRole("button", { name: "Add folder", exact: true }).click();
  await expect(
    page.getByText("/fixture/additional", { exact: true }),
  ).toBeVisible();
  expect(
    mocked.mutations.find(
      (item) => item.method === "POST" && item.path === "/api/machine/sources",
    )?.body,
  ).toEqual({ path: "/fixture/additional", label: "Additional tooling" });
  await openMachine(page);
  await page.getByRole("tab", { name: /^Sources/ }).click();
  await expect(
    page.getByText("Additional tooling", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Remove folder Additional tooling",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("/fixture/additional", { exact: true }),
  ).not.toBeVisible();
  expect(
    mocked.mutations.some(
      (item) =>
        item.method === "DELETE" &&
        item.path === "/api/machine/sources/custom-1",
    ),
  ).toBeTruthy();
  await page
    .getByRole("textbox", { name: "Folder path", exact: true })
    .fill("/missing/folder");
  await page.getByRole("button", { name: "Add folder", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Choose an existing absolute directory.",
  );
  await expect(
    page.getByRole("textbox", { name: "Folder path", exact: true }),
  ).toHaveValue("/missing/folder");
});

test("refresh is asynchronous and disconnected or older observations retain the last inventory", async ({
  page,
}) => {
  const mocked = await fixture(page);
  await openMachine(page);
  await page
    .getByRole("button", { name: "Refresh machine", exact: true })
    .click();
  await expect
    .poll(() =>
      mocked.mutations.some(
        (item) =>
          item.path === "/api/machine/refresh" &&
          JSON.stringify(item.body) === "{}",
      ),
    )
    .toBeTruthy();
  await expect(page.getByText(/Refresh requested\./)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Inspect Codex CLI", exact: true }),
  ).toBeVisible();
  mocked.offline(true);
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.getByRole("alert")).toContainText(
    "Fixture machine service is disconnected.",
  );
  await expect(
    page.getByRole("button", { name: "Inspect Codex CLI", exact: true }),
  ).toBeVisible();
  mocked.offline(false);
  mocked.set({
    ...inventory(),
    agents: [],
    scan: {
      ...inventory().scan,
      inventoryAt: "2020-01-01T00:00:00.000Z",
      runtimeAt: "2020-01-01T00:00:00.000Z",
    },
  });
  await page
    .getByRole("button", { name: "Retry machine connection", exact: true })
    .click();
  await expect(page.getByText(/older observation/i)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Inspect Codex CLI", exact: true }),
  ).toBeVisible();
  mocked.set(inventory());
  await page
    .getByRole("button", { name: "Retry machine connection", exact: true })
    .click();
  await expect(page.getByRole("alert")).not.toBeVisible();
});

test("new inventory and source changes remain usable after restart when runtime probing fails", async ({
  page,
}) => {
  const mocked = await fixture(page, inventory(), 300);
  await openMachine(page);
  await expect(
    page.getByRole("tab", { name: "Libraries 57", exact: true }),
  ).toBeVisible();
  const restarted = inventory();
  mocked.set({
    ...restarted,
    agents: restarted.agents.map((agent) => ({
      ...agent,
      version: agent.id === "codex-cli" ? "2.0.0" : agent.version,
      status: "unknown",
      processes: [],
      cpuPercent: null,
      memoryBytes: null,
    })),
    libraries: [
      {
        ...restarted.libraries[0],
        id: "after-restart",
        name: "fixture-after-restart",
      },
    ],
    scan: {
      ...restarted.scan,
      inventoryAt: "2026-09-13T09:01:00.000Z",
      runtimeAt: null,
      runtimeError: "Process observation denied after restart.",
    },
  });
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.getByRole("alert")).toContainText(
    "Process observation denied after restart.",
  );
  const codex = page.getByRole("row").filter({
    has: page.getByRole("button", { name: "Inspect Codex CLI", exact: true }),
  });
  await expect(codex).toContainText("2.0.0");
  await expect(codex).toContainText("Unknown");
  await expect(codex).not.toContainText("Running");
  await expect(codex).not.toContainText("3.5%");
  await page.getByRole("tab", { name: /^Libraries/ }).click();
  await expect(
    page.getByRole("button", { name: "fixture-after-restart", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /^Sources/ }).click();
  await page
    .getByRole("textbox", { name: "Folder path", exact: true })
    .fill("/fixture/after-restart");
  await page
    .getByRole("textbox", { name: "Folder label", exact: true })
    .fill("After restart");
  await page.getByRole("button", { name: "Add folder", exact: true }).click();
  await expect(
    page.getByText("/fixture/after-restart", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Remove folder After restart", exact: true })
    .click();
  await expect(
    page.getByText("/fixture/after-restart", { exact: true }),
  ).not.toBeVisible();
});

test("fresh runtime does not erase retained inventory while discovery restarts", async ({
  page,
}) => {
  const mocked = await fixture(page, inventory(), 300);
  await openMachine(page);
  await expect(
    page.getByRole("tab", { name: "Libraries 57", exact: true }),
  ).toBeVisible();
  const restarted = inventory();
  mocked.set({
    ...restarted,
    agents: restarted.agents.map((agent) => ({
      ...agent,
      cpuPercent: agent.id === "codex-cli" ? 6.2 : agent.cpuPercent,
    })),
    libraries: [],
    sources: [],
    scan: {
      ...restarted.scan,
      state: "scanning",
      inventoryAt: null,
      runtimeAt: "2026-09-13T09:01:00.000Z",
    },
  });
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page.getByRole("row").filter({
      has: page.getByRole("button", {
        name: "Inspect Codex CLI",
        exact: true,
      }),
    }),
  ).toContainText("6.2%");
  await page.getByRole("tab", { name: /^Libraries/ }).click();
  await expect(
    page.getByRole("button", { name: "fixture-package-00", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(/inventory.*retained/i);
});

test("machine data is fetched on entry and cadence, not on search renders or other pages", async ({
  page,
}) => {
  const mocked = await fixture(page);
  await page.clock.install();
  await openMachine(page);
  await expect.poll(mocked.reads).toBe(1);
  await page.getByRole("tab", { name: /^Libraries/ }).click();
  await page
    .getByRole("searchbox", { name: "Search libraries", exact: true })
    .fill("fixture");
  await page
    .getByRole("searchbox", { name: "Search libraries", exact: true })
    .fill("package");
  expect(mocked.reads()).toBe(1);
  await page.clock.runFor(15000);
  await expect.poll(mocked.reads).toBe(2);
  await page.evaluate(() =>
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    }),
  );
  await page.clock.runFor(15000);
  expect(mocked.reads()).toBe(2);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(mocked.reads).toBe(3);
  await page.getByRole("button", { name: /^All work/ }).click();
  await page.clock.runFor(30000);
  expect(mocked.reads()).toBe(3);
});

for (const width of [320, 768, 1440]) {
  test(`machine tables, filters and source controls fit ${width}px`, async ({
    page,
  }) => {
    await fixture(page);
    await page.setViewportSize({ width, height: 900 });
    await openMachine(page);
    for (const [index, tab] of [
      /^Agents & tools/,
      /^Libraries/,
      /^Sources/,
    ].entries()) {
      await page.getByRole("tab", { name: tab }).click();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      if (width !== 768) {
        await page.screenshot({
          path: test
            .info()
            .outputPath(
              `machine-${["agents", "libraries", "sources"][index]}.png`,
            ),
          fullPage: true,
          animations: "disabled",
        });
      }
    }
    await expect(
      page.getByRole("textbox", { name: "Folder path", exact: true }),
    ).toBeVisible();
  });
}

test("first observation has loading and empty states without invented inventory", async ({
  page,
}) => {
  const empty: MachineSnapshot = {
    ...inventory(),
    host: null,
    agents: [],
    libraries: [],
    services: [],
    sources: [],
    scan: {
      ...inventory().scan,
      state: "scanning",
      inventoryAt: null,
      runtimeAt: null,
      issues: [],
    },
  };
  const mocked = await fixture(page, empty);
  await openMachine(page);
  await expect(
    page.getByText("Waiting for the first observation", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Fixture Mac", { exact: true }),
  ).not.toBeVisible();
  mocked.set({ ...empty, scan: { ...empty.scan, state: "idle" } });
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page.getByRole("heading", {
      name: "No agents or tools discovered",
      exact: true,
    }),
  ).toBeVisible();
});

test("server-level manual refresh is isolated from the user machine", async ({
  request,
}) => {
  const refresh = await request.post("/api/machine/refresh", { data: {} });
  expect(refresh.status()).toBe(202);
  await expect
    .poll(
      async () => (await (await request.get("/api/machine")).json()).host?.name,
    )
    .toBe("Browser fixture");
  const snapshot: MachineSnapshot = await (
    await request.get("/api/machine")
  ).json();
  expect(snapshot.host?.platform).toBe("fixture");
  expect(snapshot.agents).toEqual([]);
  expect(snapshot.libraries).toEqual([]);
  expect(snapshot.services).toEqual([]);
});
