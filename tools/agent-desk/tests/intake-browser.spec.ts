import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { doc, docx, pdf } from "./fixtures/documents/synthetic.mjs";
import type { DeskState, Ticket } from "../src/types";
import type { Attachment } from "../src/intake-types";

const now = "2026-09-13T00:00:00.000Z";
const fixtureState: DeskState = {
  projects: [
    { id: "project", name: "Readable workspace", key: "SMARTSTO" },
    {
      id: "long-project",
      name: "Long identifier workspace",
      key: "ABCDEFGHIJKL",
    },
  ],
  stages: [
    {
      id: "planning",
      projectId: "project",
      name: "Planning",
      role: "planning",
      position: 0,
    },
    {
      id: "long-planning",
      projectId: "long-project",
      name: "Planning",
      role: "planning",
      position: 0,
    },
  ],
  agents: [{ id: "codex", name: "Codex", enabled: true, adapter: "codex" }],
  tickets: [
    {
      id: "ticket",
      projectId: "project",
      number: 20,
      title: "Read the complete ticket identifier",
      stageId: "planning",
      priority: "high",
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "long-ticket",
      projectId: "long-project",
      number: 99999,
      title: "Keep the longest supported identifier readable",
      stageId: "long-planning",
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

async function mockWorkspace(page: Page) {
  await page.route("**/api/state", (route) =>
    route.fulfill({ json: fixtureState }),
  );
  await page.route("**/api/integrations", (route) =>
    route.fulfill({ json: { github: { available: false }, agents: [] } }),
  );
}

async function mockIntake(page: Page) {
  const current = structuredClone(fixtureState);
  const originals = new Map<
    string,
    { attachment: Attachment; bytes: Buffer }
  >();
  const deleted: string[] = [];
  const created: Record<string, unknown>[] = [];
  let releaseSlow: (() => void) | undefined;
  let native: "cancel" | "unavailable" | "existing" = "cancel";
  let holdState = false;
  const stateGates: (() => void)[] = [];
  await page.route("**/api/state", async (route) => {
    if (holdState)
      await new Promise<void>((resolve) => stateGates.push(resolve));
    await route.fulfill({ json: current });
  });
  await page.route("**/api/integrations", (route) =>
    route.fulfill({ json: { github: { available: false }, agents: [] } }),
  );
  await page.route("**/api/attachments**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST") {
      const body = request.postDataJSON();
      if (body.name === "bad.pdf")
        return route.fulfill({
          status: 422,
          json: {
            error: {
              code: "NO_TEXT",
              message:
                "This PDF contains no extractable text. Choose a text-based PDF; OCR is not available.",
            },
          },
        });
      if (body.name === "slow.txt")
        await new Promise<void>((resolve) => {
          releaseSlow = resolve;
        });
      const bytes = Buffer.from(body.contentBase64, "base64");
      const id = `attachment-${originals.size + 1}`;
      const attachment: Attachment = {
        id,
        name: body.name,
        mediaType: body.name.endsWith(".pdf")
          ? "application/pdf"
          : "text/plain",
        size: bytes.length,
        sha256: `fixture-sha-${id}`,
        createdAt: now,
        ticketId: null,
        text: bytes.toString("utf8"),
        warnings: [],
      };
      originals.set(id, { attachment, bytes });
      return route.fulfill({ status: 201, json: attachment });
    }
    const id = path.split("/")[3];
    const original = originals.get(id);
    if (!original)
      return route.fulfill({
        status: 404,
        json: { error: { message: "Document not found." } },
      });
    if (request.method() === "DELETE") {
      if (original.attachment.ticketId)
        return route.fulfill({
          status: 409,
          json: { error: { message: "Bound originals are immutable." } },
        });
      deleted.push(id);
      originals.delete(id);
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith("/download"))
      return route.fulfill({
        body: original.bytes,
        contentType: "application/octet-stream",
        headers: {
          "Content-Disposition": `attachment; filename="${original.attachment.name}"`,
        },
      });
    return route.fulfill({ json: original.attachment });
  });
  await page.route("**/api/tickets**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/tickets" && request.method() === "POST") {
      const body = request.postDataJSON();
      created.push(body);
      const attachments = (body.attachmentIds || []).map((id: string) => {
        const attachment = originals.get(id)!.attachment;
        attachment.ticketId = "created-ticket";
        const { text: _text, ...metadata } = attachment;
        return metadata;
      });
      const ticket: Ticket = {
        ...current.tickets[0],
        ...body,
        id: "created-ticket",
        number: 21,
        stageId: body.stageId || "planning",
        attachments,
      };
      current.tickets.push(ticket);
      return route.fulfill({ status: 201, json: ticket });
    }
    const ticket = current.tickets.find(
      (item) => item.id === path.split("/")[3],
    );
    if (!ticket)
      return route.fulfill({
        status: 404,
        json: { error: { message: "Ticket not found." } },
      });
    if (request.method() === "PATCH")
      Object.assign(ticket, request.postDataJSON(), {
        version: ticket.version + 1,
      });
    return route.fulfill({
      json: {
        ...ticket,
        attachmentContext: [...originals.values()]
          .filter((item) => item.attachment.ticketId === ticket.id)
          .map((item) => item.attachment),
      },
    });
  });
  const inspection = (path: string) => ({
    path: path.includes("existing")
      ? "/fixture/existing"
      : "/fixture/repository",
    name: "Detected repository",
    key: "DETECTED",
    repo: "example/fixture",
    git: {
      isRepository: true,
      root: "/fixture/repository",
      branch: "feature/fixture",
      hasHead: true,
      dirty: true,
    },
    existingProjectId: path.includes("existing") ? "project" : null,
    warnings: [],
  });
  await page.route("**/api/project-folder/pick", (route) =>
    native === "cancel"
      ? route.fulfill({ json: { cancelled: true } })
      : native === "unavailable"
        ? route.fulfill({
            status: 409,
            json: {
              error: {
                code: "PICKER_UNAVAILABLE",
                message: "Native picker unavailable for this connection.",
              },
            },
          })
        : route.fulfill({ json: inspection("/fixture/existing") }),
  );
  await page.route("**/api/project-folders**", (route) => {
    const path =
      new URL(route.request().url()).searchParams.get("path") || "/fixture";
    return route.fulfill({
      json: {
        path,
        parentPath: path === "/fixture" ? null : "/fixture",
        directories:
          path === "/fixture"
            ? [{ name: "repository", path: "/fixture/repository" }]
            : [],
        truncated: false,
        nativePicker: true,
      },
    });
  });
  await page.route("**/api/projects/inspect", (route) =>
    route.fulfill({ json: inspection(route.request().postDataJSON().path) }),
  );
  await page.route("**/api/projects", (route) => {
    const body = route.request().postDataJSON();
    created.push(body);
    const project = { ...body, id: "new-project" };
    current.projects.push(project);
    current.stages.push({
      id: "new-stage",
      projectId: project.id,
      name: "Planning",
      role: "planning",
      position: 0,
    });
    return route.fulfill({ status: 201, json: project });
  });
  return {
    current,
    originals,
    deleted,
    created,
    release: () => releaseSlow?.(),
    slowStarted: () => !!releaseSlow,
    pauseRefresh: () => {
      holdState = true;
    },
    resumeRefresh: () => {
      holdState = false;
      stateGates.splice(0).forEach((resolve) => resolve());
    },
    setNative: (value: typeof native) => {
      native = value;
    },
  };
}

async function newTicket(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: /^New ticket/ })
    .first()
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: "New ticket", exact: true }),
  ).toBeVisible();
}

test("documents and structured brief survive creation, reload, safe preview and download", async ({
  page,
}) => {
  const mocked = await mockIntake(page);
  await newTicket(page);
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Title", { exact: true })
    .fill("Document-driven task");
  await dialog
    .getByRole("textbox", { name: "Acceptance criteria", exact: true })
    .fill("Unicode 文档 and all references persist.");
  await dialog
    .getByRole("textbox", { name: "Scope", exact: true })
    .fill("Only the fixture module.");
  await dialog
    .getByRole("textbox", { name: "Verification plan", exact: true })
    .fill("Run the fixture acceptance tests.");
  const droppedFiles = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    for (const extension of ["txt", "doc", "docx", "pdf"])
      transfer.items.add(
        new File(
          [
            `Unicode 文档 ${extension}\n<script>window.fixtureExecuted = true</script>`,
          ],
          `reference.${extension}`,
          { type: "application/octet-stream" },
        ),
      );
    return transfer;
  });
  await dialog.locator(".document-dropzone").dispatchEvent("dragover", {
    dataTransfer: droppedFiles,
  });
  await expect(dialog.locator(".document-dropzone")).toHaveClass(/dragging/);
  await dialog.locator(".document-dropzone").dispatchEvent("drop", {
    dataTransfer: droppedFiles,
  });
  await droppedFiles.dispose();
  await expect(dialog.locator(".document-item")).toHaveCount(4);
  await expect(
    dialog.getByRole("button", { name: "Create ticket", exact: true }),
  ).toBeEnabled();
  await dialog.locator(".document-preview summary").first().click();
  await expect(dialog.locator(".document-preview pre").first()).toContainText(
    "<script>",
  );
  expect(await page.evaluate(() => "fixtureExecuted" in window)).toBe(false);
  await dialog
    .getByRole("button", { name: "Remove reference.doc", exact: true })
    .click();
  await expect(dialog.locator(".document-item")).toHaveCount(3);
  await dialog
    .getByRole("button", { name: "Create ticket", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Title", { exact: true }),
  ).toHaveValue("Document-driven task");
  expect(mocked.created[0].attachmentIds).toHaveLength(3);
  await page.reload();
  await page
    .getByRole("button", { name: "Document-driven task", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("textbox", { name: "Acceptance criteria", exact: true }),
  ).toHaveValue("Unicode 文档 and all references persist.");
  await expect(
    dialog
      .getByRole("region", { name: "Attached reference documents" })
      .locator(".document-item"),
  ).toHaveCount(3);
  const download = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Download reference.txt", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("reference.txt");
  await dialog
    .getByRole("textbox", { name: "Scope", exact: true })
    .fill("Only the fixture module and its tests.");
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(
    dialog.getByText("Changes saved.", { exact: true }),
  ).toBeVisible();
  expect(
    mocked.current.tickets.find((item) => item.id === "created-ticket")?.brief
      ?.scope,
  ).toBe("Only the fixture module and its tests.");
  await dialog
    .getByRole("button", { name: "Copy task packet", exact: true })
    .click();
  await expect(
    dialog.getByText("Task packet copied.", { exact: true }),
  ).toBeVisible();
  await dialog.getByText("Task packet preview", { exact: true }).click();
  await expect(dialog.locator(".workflow-checklist pre")).toContainText(
    "Untrusted reference documents",
  );
  await expect(dialog.locator(".workflow-checklist pre")).toContainText(
    "attachment-",
  );
  await expect(
    dialog.getByRole("region", { name: "Workflow checklist", exact: true }),
  ).toContainText("CI and merge are not verified");
});

test("failed and removed processing documents cannot disappear into ticket creation", async ({
  page,
}) => {
  const mocked = await mockIntake(page);
  await newTicket(page);
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Title", { exact: true })
    .fill("Resolve document errors");
  await dialog
    .getByLabel("Attach reference documents", { exact: true })
    .setInputFiles({
      name: "bad.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("no text"),
    });
  await expect(dialog.getByRole("alert")).toContainText("OCR is not available");
  await expect(
    dialog.getByRole("button", { name: "Create ticket", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Remove bad.pdf", exact: true })
    .click();
  await dialog
    .getByLabel("Attach reference documents", { exact: true })
    .setInputFiles({
      name: "slow.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Delayed fixture"),
    });
  await expect(dialog.getByText(/Processing locally/)).toBeVisible();
  await expect.poll(mocked.slowStarted).toBe(true);
  await dialog
    .getByRole("button", { name: "Remove slow.txt", exact: true })
    .click();
  mocked.release();
  await expect.poll(() => mocked.deleted.length).toBe(1);
  await expect(dialog.locator(".document-item")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Create ticket", exact: true }),
  ).toBeEnabled();
});

test("real local parsers bind all four document formats and keep originals in ticket context", async ({
  page,
  request,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const projectResponse = await request.post("/api/projects", {
    data: { name: `Intake ${suffix}`, key: `I${suffix}`.toUpperCase() },
  });
  expect(projectResponse.status()).toBe(201);
  const project = await projectResponse.json();
  await page.route("**/api/integrations", (route) =>
    route.fulfill({ json: { github: { available: false }, agents: [] } }),
  );
  await newTicket(page);
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Project", exact: true })
    .selectOption(project.id);
  await dialog
    .getByLabel("Title", { exact: true })
    .fill(`Parse original fixtures ${suffix}`);
  await dialog
    .getByRole("textbox", { name: "Acceptance criteria", exact: true })
    .fill("All originals and extracted text persist.");
  await dialog
    .getByLabel("Attach reference documents", { exact: true })
    .setInputFiles([
      {
        name: "actual.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Text fixture 中文"),
      },
      {
        name: "actual.doc",
        mimeType: "application/msword",
        buffer: doc("Word fixture 中文"),
      },
      {
        name: "actual.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: docx("Word XML fixture 中文"),
      },
      {
        name: "actual.pdf",
        mimeType: "application/pdf",
        buffer: pdf("PDF fixture content"),
      },
    ]);
  await expect(dialog.locator(".document-item")).toHaveCount(4);
  await expect(
    dialog.getByRole("button", { name: "Create ticket", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Create ticket", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("region", { name: "Attached reference documents" })
      .locator(".document-item"),
  ).toHaveCount(4);
  const state: DeskState = await (await request.get("/api/state")).json();
  const ticket = state.tickets.find(
    (item) => item.title === `Parse original fixtures ${suffix}`,
  )!;
  expect(ticket.attachments).toHaveLength(4);
  expect(
    ticket.attachments!.every((attachment) => attachment.text === undefined),
  ).toBe(true);
  const detail: Ticket = await (
    await request.get(`/api/tickets/${ticket.id}`)
  ).json();
  expect(detail.attachmentContext).toHaveLength(4);
  expect(
    detail.attachmentContext!.every((attachment) => !!attachment.text?.trim()),
  ).toBe(true);
  for (const attachment of detail.attachmentContext!) {
    const original = await request.get(
      `/api/attachments/${attachment.id}/download`,
    );
    expect(original.ok()).toBe(true);
    expect((await original.body()).length).toBe(attachment.size);
  }
  await page.reload();
  await page
    .getByRole("button", {
      name: `Parse original fixtures ${suffix}`,
      exact: true,
    })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("textbox", { name: "Acceptance criteria", exact: true }),
  ).toHaveValue("All originals and extracted text persist.");
  await expect(
    page
      .getByRole("dialog")
      .getByRole("region", { name: "Attached reference documents" })
      .locator(".document-item"),
  ).toHaveCount(4);
});

test("server folder browsing fills untouched metadata and preserves an explicit project name", async ({
  page,
}) => {
  const mocked = await mockIntake(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Project name", { exact: true })
    .fill("My explicit project name");
  await dialog
    .getByRole("button", { name: "Choose folder", exact: true })
    .click();
  await expect(dialog.getByText(/Folder selection cancelled/)).toBeVisible();
  await expect(dialog.getByLabel("Project name", { exact: true })).toHaveValue(
    "My explicit project name",
  );
  mocked.setNative("unavailable");
  await dialog
    .getByRole("button", { name: "Choose folder", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Native picker unavailable",
  );
  await dialog
    .getByRole("button", { name: "Browse server", exact: true })
    .click();
  await dialog.getByRole("button", { name: "repository", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Use this folder", exact: true })
    .click();
  await expect(dialog.getByLabel(/Working directory/)).toHaveValue(
    "/fixture/repository",
  );
  await expect(dialog.getByLabel(/Identifier/)).toHaveValue("DETECTED");
  await expect(dialog.getByLabel(/GitHub repository/)).toHaveValue(
    "example/fixture",
  );
  await expect(dialog.getByLabel("Project name", { exact: true })).toHaveValue(
    "My explicit project name",
  );
  await expect(
    dialog.getByRole("region", { name: "Folder inspection" }),
  ).toContainText("feature/fixture");
  await expect(
    dialog.getByRole("region", { name: "Folder inspection" }),
  ).toContainText("Uncommitted changes present");
  await dialog
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "My explicit project name",
  );
  expect(mocked.created[0]).toMatchObject({
    path: "/fixture/repository",
    repo: "example/fixture",
  });
});

test("an already registered canonical folder opens the existing project without another create", async ({
  page,
}) => {
  const mocked = await mockIntake(page);
  mocked.setNative("existing");
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Choose folder", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open existing project", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Readable workspace",
  );
  expect(mocked.created).toHaveLength(0);
});

test("a successfully created ticket locks its original packet while opening is pending", async ({
  page,
}) => {
  const mocked = await mockIntake(page);
  await newTicket(page);
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Title", { exact: true })
    .fill("Already persisted packet");
  await dialog
    .getByRole("textbox", { name: "Scope", exact: true })
    .fill("The original bounded scope");
  mocked.pauseRefresh();
  await dialog
    .getByRole("button", { name: "Create ticket", exact: true })
    .click();
  await expect.poll(() => mocked.created.length).toBe(1);
  await expect(dialog.getByLabel("Title", { exact: true })).toBeDisabled();
  await expect(
    dialog.getByRole("textbox", { name: "Scope", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("combobox", { name: /^Owner Assignment records/ }),
  ).toBeDisabled();
  await expect(dialog.getByText(/Your ticket was created/)).toBeVisible();
  mocked.resumeRefresh();
  await expect(
    page.getByRole("dialog").getByLabel("Title", { exact: true }),
  ).toHaveValue("Already persisted packet");
  expect(mocked.created).toHaveLength(1);
});

test("workflow checklist exposes stage and owner holds instead of claiming readiness", async ({
  page,
}) => {
  const mocked = await mockIntake(page);
  mocked.current.stages[0].role = "parked";
  mocked.current.tickets[0].ownerId = "codex";
  mocked.current.agents[0].enabled = false;
  await page.goto("/");
  await page
    .getByRole("button", { name: fixtureState.tickets[0].title, exact: true })
    .click();
  const readiness = page
    .getByRole("region", { name: "Workflow checklist" })
    .getByRole("listitem")
    .filter({ hasText: "Readiness & holds" });
  await expect(readiness).toContainText("Stage hold");
  await expect(readiness).toContainText("disabled");
  await expect(readiness).not.toContainText("No ticket holds recorded");
});

for (const width of [320, 1440, 1920]) {
  test(`complete ticket identifiers and larger typography at ${width}px`, async ({
    page,
  }) => {
    await mockWorkspace(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await expect(
      page.getByRole("button", {
        name: fixtureState.tickets[0].title,
        exact: true,
      }),
    ).toBeVisible();
    const sizes = await page
      .locator(".ticket-row .ticket-id")
      .evaluateAll((elements) =>
        elements.map((element) => ({
          text: element.textContent,
          client: element.clientWidth,
          scroll: element.scrollWidth,
          font: parseFloat(getComputedStyle(element).fontSize),
        })),
      );
    await test.info().attach("ticket-identifier-widths", {
      body: JSON.stringify(sizes),
      contentType: "application/json",
    });
    for (const measured of sizes)
      expect(
        measured.scroll,
        `${measured.text} must fit in its visible box`,
      ).toBeLessThanOrEqual(measured.client);
    expect(
      await page.evaluate(() =>
        parseFloat(getComputedStyle(document.documentElement).fontSize),
      ),
    ).toBe(16);
    expect(sizes[0].font).toBe(width === 320 ? 11 : 13);
    await expect(page.locator("kbd").first()).toHaveCSS("font-size", "13px");
    await expect(page.locator(".ticket-title").first()).toHaveCSS(
      "font-size",
      width === 320 ? "14px" : "15px",
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    if (width !== 1920)
      await page.screenshot({
        path: test.info().outputPath("intake-list.png"),
        fullPage: true,
        animations: "disabled",
      });
    await page.getByRole("button", { name: "Board view", exact: true }).click();
    for (const size of await page
      .locator(".board-ticket .ticket-id")
      .evaluateAll((elements) =>
        elements.map((element) => ({
          client: element.clientWidth,
          scroll: element.scrollWidth,
        })),
      ))
      expect(size.scroll).toBeLessThanOrEqual(size.client);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page
      .getByRole("button", { name: /^New ticket/ })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("textbox", { name: "Acceptance criteria", exact: true }),
    ).toBeVisible();
    expect(
      await dialog.evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(
      await dialog.evaluate((element) => element.clientWidth),
    );
    await dialog.locator(".document-dropzone").scrollIntoViewIfNeeded();
    if (width === 320)
      expect(
        await dialog
          .locator(".document-dropzone > div")
          .evaluate((element) => element.clientWidth),
        "Document instructions retain a readable mobile text column",
      ).toBeGreaterThanOrEqual(150);
    if (width !== 1920)
      await page.screenshot({
        path: test.info().outputPath("intake-create.png"),
        animations: "disabled",
      });
  });
}
