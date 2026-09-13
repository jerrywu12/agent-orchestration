import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { DeskState, Execution, Project, Ticket } from "../src/types";

// Capability discovery is a bounded fixture: no test asks gh or a model provider for credentials.
// Mutation routes and persistence use the real isolated application server.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/integrations", (route) =>
    route.fulfill({
      json: {
        github: {
          available: false,
          error: "GitHub is disabled in browser fixtures.",
        },
        agents: [
          "codex",
          "claude",
          "gemini",
          "cursor",
          "antigravity",
          "hermes",
          "ollama",
          "arkcli",
        ].map((id) => ({
          id,
          available: ["codex", "claude"].includes(id),
          reason: "Browser capability fixture",
        })),
        migration: { state: "not_imported" },
      },
    }),
  );
});

const unique = (prefix: string) => `${prefix} ${randomUUID().slice(0, 8)}`;

async function state(request: APIRequestContext): Promise<DeskState> {
  const response = await request.get("/api/state");
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function projectFixture(request: APIRequestContext, label: string) {
  const response = await request.post("/api/projects", {
    data: {
      name: unique(label),
      key: `T${randomUUID().slice(0, 7)}`.toUpperCase(),
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const project: Project = await response.json();
  const snapshot = await state(request);
  const stages = snapshot.stages.filter(
    (stage) => stage.projectId === project.id,
  );
  return { project, stages };
}

async function ticketFixture(
  request: APIRequestContext,
  project: Project,
  stageId: string,
  fields: Partial<Ticket> = {},
): Promise<Ticket> {
  const response = await request.post("/api/tickets", {
    data: {
      projectId: project.id,
      stageId,
      title: unique("Ticket"),
      ...fields,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

async function openNavigation(page: Page) {
  const menu = page.getByRole("button", {
    name: "Open navigation",
    exact: true,
  });
  if (await menu.isVisible()) await menu.click();
}

async function openProject(page: Page, project: Project) {
  await openNavigation(page);
  await page
    .getByRole("navigation", { name: "Projects", exact: true })
    .getByRole("button", { name: new RegExp(project.name) })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    project.name,
  );
}

async function openSettings(page: Page) {
  await openNavigation(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Workflow stages", exact: true }),
  ).toBeVisible();
}

test("real progress reports reach a tracked bulk run without reload or a second executor", async ({
  page,
  request,
}) => {
  const { project, stages } = await projectFixture(request, "Live reports");
  const ticket = await ticketFixture(
    request,
    project,
    stages.find((s) => s.role === "ready")!.id,
    { ownerId: "codex" },
  );
  const claim = await request.post(`/api/tickets/${ticket.id}/claim`, {
    data: { agentId: "codex", sessionId: unique("external-progress") },
  });
  expect(claim.status()).toBe(201);
  const execution: Execution = await claim.json();
  const report = async (
    seq: number,
    type: string,
    summary: string,
    progress?: number,
  ) => {
    const response = await request.post(
      `/api/executions/${execution.id}/events`,
      {
        data: {
          agentId: "codex",
          sessionId: execution.sessionId,
          eventId: randomUUID(),
          seq,
          type,
          summary,
          ...(progress === undefined ? {} : { progress }),
        },
      },
    );
    expect(response.ok(), await response.text()).toBeTruthy();
  };
  await page.goto("/");
  const key = `${project.key}-${ticket.number}`;
  await page
    .getByRole("checkbox", { name: `Select ticket ${key}`, exact: true })
    .check();
  await page.getByRole("button", { name: "Run Agent", exact: true }).click();
  const panel = page.getByRole("region", { name: "Bulk run results" });
  await expect(
    panel.getByText("already running", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText("Working · no percentage reported", { exact: true }),
  ).toBeVisible();
  await report(1, "progress", "Checking baseline before implementation", 0);
  await expect(
    panel.getByText("Checking baseline before implementation", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("progressbar", { name: `Reported progress for ${key}` }),
  ).toHaveAttribute("value", "0");
  await report(2, "progress", "Verifying the regression tests", 55);
  await expect(
    panel.getByText("Verifying the regression tests", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("progressbar", { name: `Reported progress for ${key}` }),
  ).toHaveAttribute("value", "55");
  const current = await request.get(`/api/tickets/${ticket.id}`);
  expect((await current.json()).execution.id).toBe(execution.id);
  await report(3, "checkpoint", "Work saved; independent verification remains");
  await expect(
    panel.getByRole("heading", { name: "Agent run finished", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText("Work saved; independent verification remains", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(panel.getByText("checkpointed", { exact: true })).toBeVisible();
  await expect(
    panel.getByText("Updates every 2 seconds", { exact: true }),
  ).toHaveCount(0);
});

async function expectNoDocumentOverflow(page: Page, width: number) {
  const measured = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll("body *")]
      .map((element) => ({
        element: element.tagName,
        className: element.className,
        right: element.getBoundingClientRect().right,
        width: element.getBoundingClientRect().width,
      }))
      .filter(
        (element) =>
          element.right > window.innerWidth + 0.25 && element.width > 0,
      ),
  }));
  if (measured.width > width)
    await test.info().attach("horizontal-overflow", {
      body: JSON.stringify(measured, null, 2),
      contentType: "application/json",
    });
  expect(measured.width).toBeLessThanOrEqual(width);
}

test("create, assign, edit and comment through the UI; reload retains the result", async ({
  page,
  request,
}) => {
  const projectName = unique("Browser workflow");
  const title = unique("Verify independent agent progress");
  const comment = unique("Acceptance evidence recorded");
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Project name", { exact: true }).fill(projectName);
  await dialog
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    projectName,
  );

  await page.getByRole("button", { name: /^New ticket/ }).click();
  dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "New ticket", exact: true }),
  ).toBeVisible();
  await dialog.getByLabel("Title", { exact: true }).fill(title);
  await dialog
    .getByLabel(/^Description/)
    .fill("A concrete browser acceptance ticket.");

  await dialog
    .getByRole("combobox", { name: "Stage", exact: true })
    .selectOption({ label: "Ready" });
  await dialog
    .getByRole("combobox", { name: "Priority", exact: true })
    .selectOption("high");
  await dialog.getByRole("combobox", { name: /^Owner/ }).selectOption("codex");
  await dialog
    .getByRole("button", { name: "Create ticket", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Title", { exact: true })).toHaveValue(title);
  await dialog
    .getByRole("combobox", { name: "Stage", exact: true })
    .selectOption({ label: "In progress" });
  await dialog
    .getByLabel("Labels", { exact: true })
    .fill("browser, acceptance");
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(
    dialog.getByText("Changes saved.", { exact: true }),
  ).toBeVisible();
  await dialog.getByLabel("Add a comment", { exact: true }).fill(comment);
  await dialog.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(dialog.getByText(comment, { exact: true })).toBeVisible();
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();

  await page.reload();
  await page.getByRole("button", { name: title, exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("combobox", { name: "Owner", exact: true }),
  ).toHaveValue("codex");
  await expect(
    dialog.getByRole("combobox", { name: "Priority", exact: true }),
  ).toHaveValue("high");
  await expect(
    dialog
      .getByRole("combobox", { name: "Stage", exact: true })
      .locator("option:checked"),
  ).toHaveText("In progress");
  await expect(dialog.getByLabel("Labels", { exact: true })).toHaveValue(
    "browser, acceptance",
  );
  await expect(dialog.getByText(comment, { exact: true })).toBeVisible();
  const snapshot = await state(request);
  const stored = snapshot.tickets.find((ticket) => ticket.title === title)!;
  expect(stored.ownerId).toBe("codex");
  expect(stored.labels).toEqual(["browser", "acceptance"]);
  expect(
    snapshot.activity.some(
      (event) => event.ticketId === stored.id && event.summary === comment,
    ),
  ).toBeTruthy();
  expect(pageErrors).toEqual([]);
});

test("fixed workflow survives reload and custom-stage writes are rejected", async ({
  page,
  request,
}) => {
  const { project } = await projectFixture(request, "Stage workflow");
  const { project: other } = await projectFixture(request, "Other workflow");
  const names = ["Backlog", "Ready", "In progress", "In review", "Done"];
  await page.goto("/");
  await openProject(page, project);
  await openSettings(page);
  await expect(page.getByLabel("New stage name", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Add stage", exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await request.post("/api/stages", {
        data: { projectId: project.id, name: "Parked" },
      })
    ).status(),
  ).toBe(409);
  for (const id of [project.id, other.id])
    expect(
      (await state(request)).stages
        .filter((s) => s.projectId === id)
        .sort((a, b) => a.position - b.position)
        .map((s) => s.name),
    ).toEqual(names);
  await page.reload();
  await openProject(page, project);
  await openSettings(page);
  await expect(
    page.getByRole("heading", { name: "Workflow stages", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("New stage name", { exact: true })).toHaveCount(
    0,
  );
});

test("search, agent and priority filters constrain the project list and board", async ({
  page,
  request,
}) => {
  const { project, stages } = await projectFixture(request, "Filtered work");
  const first = await ticketFixture(request, project, stages[0].id, {
    title: unique("Index runner evidence"),
    ownerId: "codex",
    priority: "high",
    labels: ["focused"],
  });
  const second = await ticketFixture(request, project, stages[0].id, {
    title: unique("Review output"),
    ownerId: "claude",
    priority: "low",
  });
  const third = await ticketFixture(request, project, stages[0].id, {
    title: unique("Unassigned follow-up"),
    priority: "none",
  });
  await page.goto("/");
  await openProject(page, project);
  await page.getByLabel("Search tickets", { exact: true }).fill(first.title);
  await expect(
    page.getByRole("button", { name: first.title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: second.title, exact: true }),
  ).not.toBeVisible();
  await page.getByLabel("Search tickets", { exact: true }).fill("");
  await page
    .getByLabel("Filter by agent", { exact: true })
    .selectOption("codex");
  await page
    .getByLabel("Filter by priority", { exact: true })
    .selectOption("high");
  await expect(
    page.getByRole("button", { name: first.title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: third.title, exact: true }),
  ).not.toBeVisible();
  await page
    .getByLabel("Filter by priority", { exact: true })
    .selectOption("low");
  await expect(
    page.getByRole("heading", {
      name: "No tickets match these filters",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page.getByRole("button", { name: "Board view", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Board view", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const ticket of [first, second, third])
    await expect(
      page.getByRole("button", { name: ticket.title, exact: true }),
    ).toBeVisible();
  await expect(page.locator(".board-ticket")).toHaveCount(3);
});

for (const width of [320, 768]) {
  test(`navigation and detail editing fit a ${width}px viewport`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 780 });
    const { project, stages } = await projectFixture(
      request,
      "Responsive workspace",
    );
    const ticket = await ticketFixture(request, project, stages[0].id, {
      title: unique(
        "A long ticket title that should wrap without moving the whole document sideways",
      ),
      ownerId: "codex",
      priority: "high",
    });
    await page.goto("/");
    await openProject(page, project);
    await expect(
      page.getByRole("button", { name: ticket.title, exact: true }),
    ).toBeVisible();
    await expectNoDocumentOverflow(page, width);
    await page.getByRole("button", { name: ticket.title, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Title", { exact: true })).toHaveValue(
      ticket.title,
    );
    await expectNoDocumentOverflow(page, width);
    await dialog
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await openSettings(page);
    await expect(
      page.getByRole("heading", { name: "Workflow stages", exact: true }),
    ).toBeVisible();
    await expectNoDocumentOverflow(page, width);
  });
}

for (const width of [320, 390]) {
  test(`desktop Settings resized to ${width}px hides closed navigation from keyboard focus`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const { project } = await projectFixture(request, "Resize navigation");
    await page.goto("/");
    await openProject(page, project);
    await openSettings(page);
    await page.setViewportSize({ width, height: 780 });
    await expect(
      page.getByRole("button", { name: "Open navigation", exact: true }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await page.locator(".sidebar").boundingBox())!.x +
          (await page.locator(".sidebar").boundingBox())!.width,
      )
      .toBeLessThanOrEqual(0.5);
    await test.info().attach("closed-sidebar-bounds", {
      body: JSON.stringify(
        await page.locator(".sidebar").evaluate((element) => ({
          rect: element.getBoundingClientRect().toJSON(),
          transform: getComputedStyle(element).transform,
          visibility: getComputedStyle(element).visibility,
        })),
        null,
        2,
      ),
      contentType: "application/json",
    });
    await page
      .getByRole("link", { name: "Skip to content", exact: true })
      .focus();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Open navigation", exact: true }),
    ).toBeFocused();
    await expectNoDocumentOverflow(page, width);
  });
}

test("empty state is useful and a failed refresh preserves visible work until recovery", async ({
  page,
  request,
}) => {
  const { project, stages } = await projectFixture(
    request,
    "Offline retention",
  );
  const ticket = await ticketFixture(request, project, stages[0].id);
  const snapshot = await state(request);
  await page.route("**/api/state", (route) =>
    route.fulfill({
      json: {
        ...snapshot,
        projects: [],
        stages: [],
        tickets: [],
        activity: [],
        sync: [],
      },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "A fresh workspace, ready for your work",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Create your first project",
      exact: true,
    }),
  ).toBeVisible();
  await page.unroute("**/api/state");
  await page.reload();
  await openProject(page, project);
  await expect(
    page.getByRole("button", { name: ticket.title, exact: true }),
  ).toBeVisible();
  await page.route("**/api/state", (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: {
          code: "TEST_OFFLINE",
          message: "Test connection interrupted.",
        },
      },
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert")).toContainText(
    "Showing the last received data.",
  );
  await expect(
    page.getByRole("button", { name: ticket.title, exact: true }),
  ).toBeVisible();
  await page.unroute("**/api/state");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("alert")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: ticket.title, exact: true }),
  ).toBeVisible();
});

test("background updates preserve an unsaved draft and require explicit reload before overwriting", async ({
  page,
  request,
}) => {
  const { project, stages } = await projectFixture(request, "Concurrent edits");
  const ticket = await ticketFixture(request, project, stages[0].id);
  await page.goto("/");
  await openProject(page, project);
  await page.getByRole("button", { name: ticket.title, exact: true }).click();
  const dialog = page.getByRole("dialog");
  const draftTitle = unique("Local unsaved draft");
  const remoteTitle = unique("Other session edit");
  await dialog.getByLabel("Title", { exact: true }).fill(draftTitle);
  const response = await request.patch(`/api/tickets/${ticket.id}`, {
    data: { version: ticket.version, title: remoteTitle },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    dialog.getByText(
      "This ticket changed in another session. Your draft is preserved.",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(dialog.getByLabel("Title", { exact: true })).toHaveValue(
    draftTitle,
  );
  await expect(
    dialog.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Discard draft and load latest", exact: true })
    .click();
  await expect(dialog.getByLabel("Title", { exact: true })).toHaveValue(
    remoteTitle,
  );
  expect(
    (await state(request)).tickets.find((item) => item.id === ticket.id)?.title,
  ).toBe(remoteTitle);
});

test("external reconciliation requires evidence and confirmation for the exact source session", async ({
  page,
  request,
}) => {
  const { project, stages } = await projectFixture(
    request,
    "Source reconciliation",
  );
  const stage = stages.find((item) => item.role === "ready")!;
  const ticket = await ticketFixture(request, project, stage.id, {
    ownerId: "codex",
  });
  const sessionId = unique("source-session");
  const claimResponse = await request.post(`/api/tickets/${ticket.id}/claim`, {
    data: { agentId: "codex", sessionId, external: true },
  });
  expect(claimResponse.status(), await claimResponse.text()).toBe(201);
  const execution: Execution = await claimResponse.json();
  await page.goto("/");
  await openProject(page, project);
  await page.getByRole("button", { name: ticket.title, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Stop", exact: true }),
  ).toBeDisabled();
  await dialog.getByText(/Reconcile imported sessions/).click();
  const session = dialog
    .locator(".reconcile-session")
    .filter({ hasText: sessionId });
  await expect(session).toContainText(sessionId);
  const record = session.getByRole("button", {
    name: "Record checkpoint",
    exact: true,
  });
  await expect(record).toBeDisabled();
  const evidence =
    "Original source client stopped; checkpoint test-acceptance is saved and no executor remains active.";
  await session
    .getByLabel("Checkpoint evidence", { exact: true })
    .fill(evidence);
  await expect(record).toBeDisabled();
  await session.getByRole("checkbox").check();
  await expect(record).toBeEnabled();
  const reconcileResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/executions/${execution.id}/reconcile`) &&
      response.request().method() === "POST",
  );
  await record.click();
  const response = await reconcileResponse;
  expect(response.ok(), await response.text()).toBeTruthy();
  expect(response.request().postDataJSON()).toEqual({
    sessionId,
    summary: evidence,
    stopped: true,
  });
  await expect
    .poll(
      async () =>
        (await state(request)).tickets.find((item) => item.id === ticket.id)
          ?.execution?.releasedAt,
    )
    .toBeTruthy();
  const reconciled = (await state(request)).tickets.find(
    (item) => item.id === ticket.id,
  )!.execution!;
  expect(reconciled.sessionId).toBe(sessionId);
  expect(reconciled.primaryReconciled).toBe(true);
  expect(
    (await state(request)).activity.some(
      (item) => item.ticketId === ticket.id && item.summary.includes(evidence),
    ),
  ).toBeTruthy();
});

test("bodyless Start sends JSON and reports the unavailable project boundary without launching an agent", async ({
  page,
  request,
}) => {
  const { project, stages } = await projectFixture(request, "Start transport");
  const ticket = await ticketFixture(
    request,
    project,
    stages.find((item) => item.role === "ready")!.id,
    { ownerId: "codex" },
  );
  // No working directory is configured. Even an installed CLI must be rejected before execution.
  expect(project.path).toBeFalsy();
  await page.goto("/");
  await openProject(page, project);
  await page.getByRole("button", { name: ticket.title, exact: true }).click();
  const dialog = page.getByRole("dialog");
  const started = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/tickets/${ticket.id}/start`) &&
      response.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Start agent", exact: true })
    .click();
  const response = await started;
  expect(response.status()).toBe(422);
  expect(response.request().headers()["content-type"]).toContain(
    "application/json",
  );
  expect(response.request().postDataJSON()).toEqual({});
  const failure = await response.json();
  expect(["PROJECT_PATH", "ADAPTER_UNAVAILABLE"]).toContain(failure.error.code);
  await expect(dialog.getByRole("alert")).toContainText(failure.error.message);
  expect(
    (await state(request)).tickets.find((item) => item.id === ticket.id)
      ?.execution,
  ).toBeNull();
});
