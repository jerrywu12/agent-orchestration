import { expect, test, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { DeskState, Ticket } from "../src/types";
import type { Attachment } from "../src/intake-types";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const source =
  "# Complete specification\n\n- A list item\n\n| Field | Value |\n| --- | --- |\n| Scope | Local |\n\n```js\nconst safe = true;\n```\n\n[Safe link](https://example.com/reference)\n\n[Unsafe link](javascript:alert(1))\n\n![Never fetch](https://remote-image.invalid/image.png)\n\n<script>window.markdownExecuted = true</script>\n\n";
async function fixture(
  page: Page,
  text = source,
  empty = false,
  name = "spec.MD",
) {
  const now = "2026-09-14T00:00:00Z";
  let attachment: Attachment = {
    id: "document",
    name,
    mediaType: "text/markdown",
    text,
    size: Buffer.byteLength(text),
    sha256: hash(text),
    createdAt: now,
    ticketId: "ticket",
    warnings: [],
  };
  const ticket: Ticket = {
    id: "ticket",
    number: 1,
    projectId: "project",
    title: "Document task",
    description: "Human request",
    stageId: "backlog",
    priority: "none",
    effort: "S",
    version: 1,
    createdAt: now,
    updatedAt: now,
    attachments: empty ? [] : [attachment],
    attachmentContext: empty ? [] : [attachment],
  };
  const state: DeskState = {
    projects: [{ id: "project", key: "DOC", name: "Markdown fixture" }],
    stages: [
      {
        id: "backlog",
        projectId: "project",
        name: "Backlog",
        role: "backlog",
        position: 0,
      },
    ],
    agents: [],
    tickets: [ticket],
    activity: [],
    sync: [],
    capabilities: { localMode: true },
    serverTime: now,
  };
  const writes: { path: string; body: any }[] = [];
  let failure: "conflict" | "offline" | "" = "";
  let hold: (() => void) | undefined;
  let delay = false;
  let delayBind = false;
  let releaseBind: (() => void) | undefined;
  let loseBindResponse = false;
  let failDetail = false;
  let bound = false;
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (path === "/api/state") return route.fulfill({ json: state });
    if (path === "/api/integrations")
      return route.fulfill({
        json: { github: { available: false }, agents: [] },
      });
    if (path.endsWith("/download"))
      return route.fulfill({
        body: attachment.text!,
        headers: {
          "Content-Type": "text/markdown",
          "Content-Disposition": 'attachment; filename="spec.MD"',
        },
      });
    if (req.method() !== "GET") {
      const body = req.postDataJSON();
      writes.push({ path, body });
      if (path === "/api/attachments/document" && req.method() === "PATCH") {
        if (delay)
          await new Promise<void>((resolve) => {
            hold = resolve;
          });
        if (failure)
          return route.fulfill({
            status: failure === "conflict" ? 409 : 503,
            json: {
              error: {
                code:
                  failure === "conflict"
                    ? "ATTACHMENT_CONFLICT"
                    : "UNAVAILABLE",
                message:
                  failure === "conflict"
                    ? "Document changed elsewhere."
                    : "Save service unavailable.",
              },
            },
          });
        attachment = {
          ...attachment,
          text: body.text,
          sha256: hash(body.text),
          size: Buffer.byteLength(body.text),
        };
        ticket.attachments = [attachment];
        ticket.attachmentContext = [attachment];
        ticket.version++;
        return route.fulfill({ json: attachment });
      }
      if (path === "/api/attachments") {
        const text = Buffer.from(body.contentBase64, "base64").toString("utf8");
        attachment = {
          ...attachment,
          id: "uploaded",
          name: body.name,
          text,
          sha256: hash(text),
          ticketId: null,
        };
        return route.fulfill({ status: 201, json: attachment });
      }
      if (path === "/api/tickets/ticket/attachments") {
        if (delayBind)
          await new Promise<void>((resolve) => {
            releaseBind = resolve;
          });
        if (!bound) {
          if (body.version !== ticket.version)
            return route.fulfill({
              status: 409,
              json: {
                error: { code: "VERSION_CONFLICT", message: "Ticket changed." },
              },
            });
          attachment = { ...attachment, ticketId: "ticket" };
          ticket.attachments = [attachment];
          ticket.attachmentContext = [attachment];
          ticket.version++;
          state.activity.push({
            id: "bound-event",
            ticketId: ticket.id,
            kind: "attachments_added",
            summary: "Bound one document",
            at: now,
          });
          bound = true;
        }
        if (loseBindResponse) {
          loseBindResponse = false;
          return route.abort("failed");
        }
        return route.fulfill({ json: ticket });
      }
      if (path === "/api/tickets/ticket") {
        Object.assign(ticket, body);
        ticket.version++;
      }
    }
    if (path === "/api/tickets/ticket") {
      if (bound && failDetail)
        return route.fulfill({
          status: 503,
          json: { error: { message: "Document refresh unavailable." } },
        });
      return route.fulfill({ json: ticket });
    }
    if (path === "/api/attachments/document")
      return route.fulfill({ json: attachment });
    return route.fulfill({ json: [] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: ticket.title, exact: true }).click();
  return {
    ticket,
    writes,
    state,
    delayBind: () => {
      delayBind = true;
    },
    releaseBind: () => releaseBind?.(),
    loseBindResponse: () => {
      loseBindResponse = true;
    },
    failDetail: (value: boolean) => {
      failDetail = value;
    },
    fail: (value: typeof failure) => {
      failure = value;
    },
    delay: () => {
      delay = true;
    },
    release: () => hold?.(),
    replace: (text: string) => {
      attachment = { ...attachment, text, sha256: hash(text) };
      ticket.attachments = [attachment];
      ticket.attachmentContext = [attachment];
      ticket.version++;
    },
  };
}
async function reader(page: Page) {
  await page.getByRole("button", { name: "Read spec.MD", exact: true }).click();
  return page.getByRole("dialog", { name: "spec.MD", exact: true });
}

test("Markdown reader renders the complete long document with safe formatting and no remote content", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("remote-image.invalid")) requests.push(req.url());
  });
  await fixture(
    page,
    source +
      "Long paragraph content. ".repeat(6500) +
      "\n\n## End of complete document\n",
  );
  const doc = await reader(page);
  await expect(
    doc.getByRole("heading", { name: "Complete specification" }),
  ).toBeVisible();
  await expect(
    doc.getByRole("heading", { name: "End of complete document" }),
  ).toHaveCount(1);
  await expect(doc.getByRole("table")).toHaveCount(1);
  await expect(doc.locator("pre code")).toHaveText("const safe = true;\n");
  await expect(
    doc.getByRole("link", { name: "Safe link", exact: true }),
  ).toHaveAttribute("href", "https://example.com/reference");
  await expect(doc.locator('a[href^="javascript:"], img, script')).toHaveCount(
    0,
  );
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => "markdownExecuted" in window)).toBe(false);
});

test("Markdown edit preview save and reopen retain full source and update the exact hash", async ({
  page,
}) => {
  const f = await fixture(page);
  const doc = await reader(page);
  await doc.getByRole("button", { name: "Edit", exact: true }).click();
  const input = doc.getByRole("textbox", {
    name: "Markdown source",
    exact: true,
  });
  await expect(input).toHaveValue(source);
  const edited = "# Edited locally\n\nWhitespace preserved.  \n\n";
  await input.fill(edited);
  await doc.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(
    doc.getByRole("heading", { name: "Edited locally" }),
  ).toBeVisible();
  await doc.getByRole("button", { name: "Save", exact: true }).click();
  await expect(doc.getByRole("status")).toContainText("Document saved");
  expect(
    f.writes.find((write) => write.path === "/api/attachments/document")?.body,
  ).toEqual({ expectedSha256: hash(source), text: edited });
  await doc
    .getByRole("button", { name: "Close document", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "DOC-1", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Document task", exact: true })
    .click();
  const reopened = await reader(page);
  await expect(
    reopened.getByRole("heading", { name: "Edited locally" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await reopened.getByRole("button", { name: "Download", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("spec.MD");
});

for (const failure of ["conflict", "offline"] as const) {
  test(`${failure} saves preserve draft and require explicit discard before reload`, async ({
    page,
  }) => {
    const f = await fixture(page);
    const doc = await reader(page);
    await doc.getByRole("button", { name: "Edit", exact: true }).click();
    await doc
      .getByRole("textbox", { name: "Markdown source" })
      .fill("# Unsaved local source");
    f.fail(failure);
    f.replace("# Newer server source");
    await doc.getByRole("button", { name: "Save", exact: true }).click();
    await expect(doc.getByRole("alert")).toContainText(
      failure === "conflict"
        ? "Document changed elsewhere"
        : "Save service unavailable",
    );
    await expect(
      doc.getByRole("textbox", { name: "Markdown source" }),
    ).toHaveValue("# Unsaved local source");
    await doc
      .getByRole("button", { name: "Reload document", exact: true })
      .click();
    await expect(
      doc.getByText("Discard unsaved document changes?", { exact: true }),
    ).toBeVisible();
    await doc
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    await expect(
      doc.getByRole("textbox", { name: "Markdown source" }),
    ).toHaveValue("# Unsaved local source");
    await doc
      .getByRole("button", { name: "Reload document", exact: true })
      .click();
    await doc
      .getByRole("button", { name: "Discard and reload", exact: true })
      .click();
    await expect(
      doc.getByRole("heading", { name: "Newer server source" }),
    ).toBeVisible();
  });
}

test("dirty nested Markdown dialog protects Escape backdrop browser reload and ticket drawer", async ({
  page,
}) => {
  await fixture(page);
  const doc = await reader(page);
  await doc.getByRole("button", { name: "Edit", exact: true }).click();
  await doc.getByRole("textbox", { name: "Markdown source" }).fill("# Keep me");
  await page.keyboard.press("Escape");
  await expect(
    doc.getByText("Discard unsaved document changes?", { exact: true }),
  ).toBeVisible();
  await doc.getByRole("button", { name: "Keep editing", exact: true }).click();
  await page.mouse.click(1, 1);
  await expect(
    doc.getByText("Discard unsaved document changes?", { exact: true }),
  ).toBeVisible();
  await doc.getByRole("button", { name: "Keep editing", exact: true }).click();
  const navigation = page.waitForEvent("dialog");
  const reloading = page.evaluate(() => {
    window.location.reload();
  });
  const warning = await navigation;
  expect(warning.type()).toBe("beforeunload");
  await warning.dismiss();
  await reloading;
  await expect(
    doc.getByRole("textbox", { name: "Markdown source" }),
  ).toHaveValue("# Keep me");
  await page.keyboard.press("Escape");
  await doc
    .getByRole("button", { name: "Discard and close", exact: true })
    .click();
  await expect(doc).not.toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "DOC-1", exact: true }),
  ).toBeVisible();
});

test("pending Markdown save blocks close reload and repeated save", async ({
  page,
}) => {
  const f = await fixture(page);
  const doc = await reader(page);
  await doc.getByRole("button", { name: "Edit", exact: true }).click();
  await doc
    .getByRole("textbox", { name: "Markdown source" })
    .fill("# Pending source");
  f.delay();
  await doc.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    doc.getByRole("button", { name: "Close document" }),
  ).toBeDisabled();
  await expect(
    doc.getByRole("button", { name: "Reload document" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(doc).toBeVisible();
  await expect.poll(() => f.writes.length).toBe(1);
  f.release();
  await expect(doc.getByRole("status")).toContainText("Document saved");
});

test("existing ticket accepts Markdown while dirty ticket fields prevent attachment mutations", async ({
  page,
}) => {
  const f = await fixture(page, source, true);
  const details = page.getByRole("dialog", { name: "DOC-1", exact: true });
  await details
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Changed request");
  await expect(
    details.getByRole("button", { name: "Attach files", exact: true }),
  ).toBeDisabled();
  await details
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(
    details.getByText("Changes saved.", { exact: true }),
  ).toBeVisible();
  await details
    .getByRole("button", { name: "Attach files", exact: true })
    .click();
  const upload = page.getByRole("dialog", {
    name: "Attach documents",
    exact: true,
  });
  await upload
    .getByLabel("Attach reference documents", { exact: true })
    .setInputFiles({
      name: "added.markdown",
      mimeType: "text/markdown",
      buffer: Buffer.from("# New attachment"),
    });
  await upload
    .getByRole("button", { name: "Attach documents", exact: true })
    .click();
  await expect(upload).not.toBeVisible();
  await expect(
    details.getByRole("button", { name: "Read added.markdown", exact: true }),
  ).toBeVisible();
  expect(
    f.writes.find(
      (write) =>
        write.path.endsWith("/attachments") && write.path.includes("/tickets/"),
    )?.body,
  ).toEqual({ version: 2, attachmentIds: ["uploaded"] });
});

test("Markdown reader and editor fit a 320px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await fixture(page, source + "\n\n" + "long-token".repeat(80));
  const doc = await reader(page);
  expect(
    await doc.evaluate((element) => element.scrollWidth),
  ).toBeLessThanOrEqual(await doc.evaluate((element) => element.clientWidth));
  await doc.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    doc.getByRole("textbox", { name: "Markdown source" }),
  ).toBeVisible();
  expect(
    await doc.evaluate((element) => element.scrollWidth),
  ).toBeLessThanOrEqual(await doc.evaluate((element) => element.clientWidth));
});

test("polling preserves an open Markdown draft and its original concurrency token", async ({
  page,
}) => {
  await page.clock.install();
  const f = await fixture(page);
  const doc = await reader(page);
  await doc.getByRole("button", { name: "Edit", exact: true }).click();
  await doc
    .getByRole("textbox", { name: "Markdown source", exact: true })
    .fill("# My in-progress draft");
  f.replace("# Polling has newer content");
  await page.clock.fastForward(4100);
  await expect(
    doc.getByRole("textbox", { name: "Markdown source", exact: true }),
  ).toHaveValue("# My in-progress draft");
  f.fail("conflict");
  await doc.getByRole("button", { name: "Save", exact: true }).click();
  await expect(doc.getByRole("alert")).toContainText(
    "Document changed elsewhere",
  );
  expect(f.writes.at(-1)?.body.expectedSha256).toBe(hash(source));
});

test("Markdown source keeps over-limit text intact and disables invalid saves", async ({
  page,
}) => {
  const f = await fixture(page);
  const doc = await reader(page);
  await doc.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = doc.getByRole("textbox", {
    name: "Markdown source",
    exact: true,
  });
  const tooLong = "a".repeat(200000) + "Z";
  await editor.fill(tooLong);
  await expect(editor).toHaveValue(tooLong);
  await expect(
    doc.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await editor.fill(" ");
  await expect(
    doc.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  expect(f.writes).toEqual([]);
});

test("attachment dialog Escape protects uploaded drafts and leaves the ticket open on discard", async ({
  page,
}) => {
  const f = await fixture(page, source, true);
  await page.getByRole("button", { name: "Attach files", exact: true }).click();
  const upload = page.getByRole("dialog", {
    name: "Attach documents",
    exact: true,
  });
  await upload
    .getByLabel("Attach reference documents", { exact: true })
    .setInputFiles({
      name: "draft.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Draft upload"),
    });
  await expect(
    upload.getByRole("button", { name: "Attach documents", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(
    upload.getByText("Discard these document uploads?", { exact: true }),
  ).toBeVisible();
  await upload
    .getByRole("button", { name: "Keep editing", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await upload
    .getByRole("button", { name: "Discard and close", exact: true })
    .click();
  await expect(upload).not.toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "DOC-1", exact: true }),
  ).toBeVisible();
  expect(
    f.writes.filter(
      (write) => write.path === "/api/tickets/ticket/attachments",
    ),
  ).toEqual([]);
});

test("real Markdown upload edit and download update only the attached ticket copy", async ({
  page,
  request,
}) => {
  const key = `M${randomUUID().slice(0, 7)}`;
  const project = await (
    await request.post("/api/projects", {
      data: { name: `Markdown ${key}`, key },
    })
  ).json();
  const state: DeskState = await (await request.get("/api/state")).json();
  const stage = state.stages.find(
    (item) => item.projectId === project.id && item.role === "backlog",
  )!;
  const created = await request.post("/api/tickets", {
    data: {
      projectId: project.id,
      stageId: stage.id,
      title: `Attached Markdown ${key}`,
      effort: "M",
      description: "Keep this ticket request unchanged.",
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const ticket: Ticket = await created.json();
  const original = Buffer.from(
    "# Original local copy\n\nTrailing spaces stay.  \n",
  );
  const uploaded = await request.post("/api/attachments", {
    data: {
      name: "integration.md",
      contentBase64: original.toString("base64"),
    },
  });
  expect(uploaded.status(), await uploaded.text()).toBe(201);
  const attachment: Attachment = await uploaded.json();
  const bound = await request.post(`/api/tickets/${ticket.id}/attachments`, {
    data: { version: ticket.version, attachmentIds: [attachment.id] },
  });
  expect(bound.ok(), await bound.text()).toBeTruthy();
  const before: Ticket = await bound.json();
  await page.goto("/");
  await page.getByRole("button", { name: ticket.title, exact: true }).click();
  await page
    .getByRole("button", { name: "Read integration.md", exact: true })
    .click();
  const doc = page.getByRole("dialog", { name: "integration.md", exact: true });
  await expect(
    doc.getByRole("heading", { name: "Original local copy" }),
  ).toBeVisible();
  await doc.getByRole("button", { name: "Edit", exact: true }).click();
  const edited = "# Stored edited copy\n\nUnicode 文档 and spaces.  \n";
  await doc
    .getByRole("textbox", { name: "Markdown source", exact: true })
    .fill(edited);
  await doc.getByRole("button", { name: "Save", exact: true }).click();
  await expect(doc.getByRole("status")).toContainText("Document saved");
  const downloaded = page.waitForEvent("download");
  await doc.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloaded;
  expect(await readFile((await download.path())!, "utf8")).toBe(edited);
  const after: Ticket = await (
    await request.get(`/api/tickets/${ticket.id}`)
  ).json();
  expect(after.attachmentContext?.[0].text).toBe(edited);
  expect(after.attachments?.[0].sha256).toBe(hash(edited));
  expect(after.version).toBe(before.version + 1);
  for (const field of [
    "title",
    "description",
    "ownerId",
    "stageId",
    "effort",
    "brief",
    "dependsOn",
    "parentId",
    "execution",
  ] as const)
    expect(after[field]).toEqual(before[field]);
  expect(original.toString("utf8")).toBe(
    "# Original local copy\n\nTrailing spaces stay.  \n",
  );
  await doc
    .getByRole("button", { name: "Close document", exact: true })
    .click();
  await page.reload();
  await page.getByRole("button", { name: ticket.title, exact: true }).click();
  await page
    .getByRole("button", { name: "Read integration.md", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "integration.md", exact: true })
      .getByRole("heading", { name: "Stored edited copy" }),
  ).toBeVisible();
});

async function prepareDraftUpload(page: Page) {
  await page.getByRole("button", { name: "Attach files", exact: true }).click();
  const upload = page.getByRole("dialog", {
    name: "Attach documents",
    exact: true,
  });
  await upload
    .getByLabel("Attach reference documents", { exact: true })
    .setInputFiles({
      name: "draft.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Draft upload"),
    });
  await expect(
    upload.getByRole("button", { name: "Attach documents", exact: true }),
  ).toBeEnabled();
  return upload;
}

test("pending append disables an already open discard confirmation", async ({
  page,
}) => {
  const f = await fixture(page, source, true);
  const upload = await prepareDraftUpload(page);
  await page.keyboard.press("Escape");
  f.delayBind();
  await upload
    .getByRole("button", { name: "Attach documents", exact: true })
    .click();
  await expect(
    upload.getByRole("button", { name: "Discard and close", exact: true }),
  ).toBeDisabled();
  await expect(
    upload.getByRole("button", { name: "Keep editing", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(upload).toBeVisible();
  await expect
    .poll(
      () =>
        f.writes.filter(
          (write) => write.path === "/api/tickets/ticket/attachments",
        ).length,
    )
    .toBe(1);
  f.releaseBind();
  await expect(upload).not.toBeVisible();
  expect(
    f.writes.filter((write) => write.path === "/api/attachments/uploaded"),
  ).toEqual([]);
});

test("long Markdown filename leaves final reader content and editor controls reachable at320px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 600 });
  const filename = "Long specification filename ".repeat(7) + ".md";
  await fixture(
    page,
    source + "\n\nParagraph.\n\n".repeat(100) + "## Last visible heading\n",
    false,
    filename,
  );
  await page
    .getByRole("button", { name: `Read ${filename}`, exact: true })
    .click();
  const doc = page.getByRole("dialog", { name: filename, exact: true });
  await doc.locator(".markdown-scroll").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    doc.getByRole("heading", { name: "Last visible heading" }),
  ).toBeInViewport({ ratio: 1 });
  await doc.getByRole("button", { name: "Edit", exact: true }).click();
  await doc.locator(".markdown-scroll").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    doc.locator(".markdown-editor-label .field-hint"),
  ).toBeInViewport({ ratio: 1 });
});

test("lost append response replays the same request without rebinding or another event", async ({
  page,
}) => {
  await page.clock.install();
  const f = await fixture(page, source, true);
  const upload = await prepareDraftUpload(page);
  f.loseBindResponse();
  await upload
    .getByRole("button", { name: "Attach documents", exact: true })
    .click();
  await expect(upload.getByRole("alert")).toContainText(
    "Unable to reach Agent Desk",
  );
  await page.clock.fastForward(4100);
  await upload
    .getByRole("button", { name: "Attach documents", exact: true })
    .click();
  await expect(upload).not.toBeVisible();
  const binds = f.writes.filter(
    (write) => write.path === "/api/tickets/ticket/attachments",
  );
  expect(binds).toHaveLength(2);
  expect(binds[1].body).toEqual(binds[0].body);
  expect(f.ticket.version).toBe(2);
  expect(f.ticket.attachments).toHaveLength(1);
  expect(f.state.activity).toHaveLength(1);
});

test("acknowledged append survives refresh failure without resubmitting or deleting bound content", async ({
  page,
}) => {
  const f = await fixture(page, source, true);
  const upload = await prepareDraftUpload(page);
  f.failDetail(true);
  await upload
    .getByRole("button", { name: "Attach documents", exact: true })
    .click();
  await expect(upload.getByRole("alert")).toContainText(
    "Document refresh unavailable",
  );
  expect(f.ticket.attachments).toHaveLength(1);
  f.failDetail(false);
  await upload
    .getByRole("button", { name: "Retry document refresh", exact: true })
    .click();
  await expect(upload).not.toBeVisible();
  expect(
    f.writes.filter(
      (write) => write.path === "/api/tickets/ticket/attachments",
    ),
  ).toHaveLength(1);
  expect(
    f.writes.filter((write) => write.path === "/api/attachments/uploaded"),
  ).toHaveLength(0);
  expect(f.state.activity).toHaveLength(1);
});

test("new-ticket Markdown uploads open a complete read-only draft reader", async ({
  page,
}) => {
  await fixture(page, source, true);
  await page
    .getByRole("dialog", { name: "DOC-1", exact: true })
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page.getByRole("button", { name: /^New ticket/ }).click();
  const create = page.getByRole("dialog", { name: "New ticket", exact: true });
  const text =
    "# Draft specification\n\n" +
    "Body text. ".repeat(1500) +
    "\n\n## Full draft ending\n";
  await create
    .getByLabel("Attach reference documents", { exact: true })
    .setInputFiles({
      name: "draft.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(text),
    });
  await create
    .getByRole("button", { name: "Read draft.md", exact: true })
    .click();
  const doc = page.getByRole("dialog", { name: "draft.md", exact: true });
  await expect(
    doc.getByRole("heading", { name: "Full draft ending" }),
  ).toHaveCount(1);
  await expect(
    doc.getByRole("button", { name: "Edit", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(doc).not.toBeVisible();
  await expect(create).toBeVisible();
});
