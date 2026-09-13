import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { DeskState } from "../src/types";

const brief = { specification: "specs/fixture.md", acceptanceCriteria: "Independent test passes", scope: "One synthetic module", verification: "Run synthetic test", allowedPaths: "src/fixture.ts", conflictKeys: "none" };
async function fixture(page: Page, options: { missing?: boolean; outcome?: "started" | "queued" | "failed"; stale?: boolean } = {}) {
  const state: DeskState = {
    projects: [{ id: "project", key: "PLAN", name: "Planning fixture", path: "/fixture" }],
    stages: ["backlog", "planning", "ready", "active", "review", "done"].map((role, i) => ({ id: role, role: role as DeskState["stages"][number]["role"], name: ["Backlog", "Planning", "Ready", "In progress", "In review", "Done"][i], position: i, projectId: "project" })),
    agents: [{ id: "codex", name: "Codex", adapter: "codex", enabled: true }, { id: "claude", name: "Claude", adapter: "claude", enabled: true }],
    tickets: [{ id: "ticket", projectId: "project", number: 1, title: "Prepare synthetic feature", stageId: "backlog", priority: "none", version: 7, brief, createdAt: "2026-09-13T00:00:00Z", updatedAt: "2026-09-13T00:00:00Z" }],
    activity: [], sync: [], capabilities: { localMode: true }, serverTime: "2026-09-13T00:00:00Z",
  };
  const writes: { path: string; body: any }[] = [];
  await page.route("**/api/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path === "/api/state") return route.fulfill({ json: state });
    if (path === "/api/integrations") return route.fulfill({ json: { github: { available: false }, agents: state.agents.map(a => ({ id: a.id, available: true })) } });
    if (path.endsWith("/readiness")) return route.fulfill({ json: options.missing ? { ready: false, missing: ["specification", "allowedPaths"], holds: ["Unfinished dependency"], conflicts: [{ ticketId: "other", key: "PLAN-2", title: "Competing schema", reasons: ["Shared resource: schema"] }] } : { ready: true, missing: [], holds: [], conflicts: [] } });
    if (req.method() !== "GET") {
      const body = req.postDataJSON(); writes.push({ path, body });
      if (path.endsWith("/transition")) {
        if (options.stale) return route.fulfill({ status: 409, json: { error: { message: "Ticket version changed" } } });
        Object.assign(state.tickets[0], { stageId: body.stageId, ownerId: body.ownerId, version: 8 });
        state.tickets[0].launchIntent = { status: options.outcome || "started", purpose: body.stageId === "planning" ? "planning" : "implementation", ownerId: body.ownerId, reason: options.outcome === "queued" ? "agent is busy" : "fixture unavailable" };
        if (body.stageId === "planning") state.tickets[0].execution = { id: "planning-execution", ticketId: "ticket", agentId: body.ownerId, sessionId: "synthetic-planner", state: "running", purpose: "planning", heartbeatAt: state.serverTime };
        return route.fulfill({ json: { ticket: state.tickets[0], outcome: options.outcome || "started", reason: options.outcome === "queued" ? "Queued: agent is busy" : options.outcome === "failed" ? "Launch failed: fixture unavailable" : undefined } });
      }
      Object.assign(state.tickets[0], body, { version: state.tickets[0].version + 1 });
    }
    if (path === "/api/tickets/ticket") return route.fulfill({ json: { ...state.tickets[0], attachmentContext: [] } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/");
  return { state, writes };
}

for (const surface of ["list", "details"]) {
  test(`${surface}: cancel Planning or Ready does not mutate stage, owner or execution`, async ({ page }) => {
    const f = await fixture(page);
    if (surface === "details") await page.getByRole("button", { name: f.state.tickets[0].title, exact: true }).click();
    for (const stage of ["planning", "ready"]) {
      await page.getByRole("combobox", { name: surface === "list" ? "Stage for PLAN-1" : "Stage", exact: true }).selectOption(stage);
      const dialog = page.getByRole("dialog", { name: stage === "planning" ? "Start planning" : "Move to Ready" });
      await dialog.getByRole("combobox").selectOption("claude");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    }
    expect(f.writes).toEqual([]);
    expect(f.state.tickets[0].stageId).toBe("backlog");
    expect(f.state.tickets[0].ownerId).toBeUndefined();
  });
}

test("Ready reports missing preparation, dependency and competing ticket before admission", async ({ page }) => {
  const f = await fixture(page, { missing: true });
  await page.getByRole("combobox", { name: "Stage for PLAN-1" }).selectOption("ready");
  const dialog = page.getByRole("dialog", { name: "Move to Ready" });
  await dialog.getByLabel("Development agent").selectOption("codex");
  for (const text of ["Specification reference", "Allowed paths", "Unfinished dependency", "PLAN-2 · Competing schema", "Shared resource: schema"]) await expect(dialog).toContainText(text);
  await expect(dialog.getByRole("button", { name: "Confirm and start", exact: true })).toBeDisabled();
  expect(f.writes).toEqual([]);
});

for (const outcome of ["started", "queued", "failed"] as const) {
  test(`Ready confirms chosen owner and displays ${outcome}`, async ({ page }) => {
    const f = await fixture(page, { outcome });
    await page.getByRole("combobox", { name: "Stage for PLAN-1" }).selectOption("ready");
    const dialog = page.getByRole("dialog", { name: "Move to Ready" });
    await expect(dialog.getByRole("button", { name: "Confirm and start", exact: true })).toBeDisabled();
    await dialog.getByLabel("Development agent").selectOption("claude");
    await dialog.getByRole("button", { name: "Confirm and start", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: outcome === "started" ? "Development agent started." : outcome === "queued" ? "Queued: agent is busy" : "Launch failed: fixture unavailable" })).toBeVisible();
    expect(f.writes).toEqual([{ path: "/api/tickets/ticket/transition", body: { version: 7, stageId: "ready", ownerId: "claude", confirmed: true } }]);
  });
}

test("stale confirmation retains modal and cannot report a successful start", async ({ page }) => {
  const f = await fixture(page, { stale: true });
  await page.getByRole("combobox", { name: "Stage for PLAN-1" }).selectOption("ready");
  const dialog = page.getByRole("dialog", { name: "Move to Ready" });
  await dialog.getByLabel("Development agent").selectOption("codex");
  await dialog.getByRole("button", { name: "Confirm and start", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Ticket version changed");
  expect(f.state.tickets[0].stageId).toBe("backlog");
});

test("queued admission survives reload and disables duplicate Start in details", async ({ page }) => {
  const f = await fixture(page, { outcome: "queued" });
  await page.getByRole("combobox", { name: "Stage for PLAN-1" }).selectOption("ready");
  const confirm = page.getByRole("dialog", { name: "Move to Ready" });
  await confirm.getByLabel("Development agent").selectOption("codex");
  await confirm.getByRole("button", { name: "Confirm and start", exact: true }).click();
  await expect(confirm).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole("article", { name: "PLAN-1 Prepare synthetic feature" })).toContainText("Queued");
  await page.getByRole("button", { name: f.state.tickets[0].title, exact: true }).click();
  const detail = page.getByRole("dialog", { name: "PLAN-1" });
  await expect(detail.getByRole("status").filter({ hasText: "Queued: agent is busy" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Start agent", exact: true })).toBeDisabled();
  expect(f.writes).toHaveLength(1);
});

test("details require saving all six preparation fields before planning confirmation", async ({ page }) => {
  const f = await fixture(page);
  await page.getByRole("button", { name: f.state.tickets[0].title, exact: true }).click();
  const detail = page.getByRole("dialog");
  for (const label of ["Specification", "Acceptance criteria", "Scope", "Verification plan", "Allowed paths", "Shared resources"]) await expect(detail.getByRole("textbox", { name: label, exact: true })).toBeVisible();
  await detail.getByRole("textbox", { name: "Specification", exact: true }).fill("specs/revised.md");
  await detail.getByRole("combobox", { name: "Stage", exact: true }).selectOption("planning");
  await expect(detail.getByRole("alert").filter({ hasText: "Save your preparation changes" })).toBeVisible();
  expect(f.writes).toEqual([]);
  await detail.getByRole("button", { name: "Save changes" }).click();
  await expect(detail.getByText("Changes saved.", { exact: true })).toBeVisible();
  await detail.getByRole("combobox", { name: "Stage", exact: true }).selectOption("planning");
  const dialog = page.getByRole("dialog", { name: "Start planning" });
  await dialog.getByLabel("Planning agent").selectOption("codex");
  await dialog.getByRole("button", { name: "Confirm and start planning" }).click();
  await expect(page.getByRole("dialog", { name: "PLAN-1" }).getByRole("status").filter({ hasText: "Planning agent started." })).toBeVisible();
  await expect(page.getByText("Active local session · planning", { exact: true })).toBeVisible();
  expect(f.writes.at(-1)?.body).toMatchObject({ stageId: "planning", ownerId: "codex", confirmed: true, version: 8 });
});

test("isolated API rejects incomplete Ready and stale transitions without dispatch", async ({ request }) => {
  const projectResponse = await request.post("/api/projects", { data: { name: `Admission ${randomUUID()}`, key: `T${randomUUID().slice(0, 7)}` } });
  expect(projectResponse.status()).toBe(201);
  const project = await projectResponse.json();
  const state = await (await request.get("/api/state")).json();
  const stages = state.stages.filter((s: any) => s.projectId === project.id);
  expect(stages.map((s: any) => s.name)).toEqual(["Backlog", "Planning", "Ready", "In progress", "In review", "Done"]);
  const response = await request.post("/api/tickets", { data: { projectId: project.id, stageId: stages[0].id, title: "Incomplete synthetic work" } });
  expect(response.status()).toBe(201);
  const ticket = await response.json();
  const readiness = await (await request.get(`/api/tickets/${ticket.id}/readiness`)).json();
  expect(readiness.ready).toBe(false);
  expect(readiness.missing.length).toBeGreaterThan(0);
  for (const version of [ticket.version, ticket.version - 1]) {
    const rejected = await request.post(`/api/tickets/${ticket.id}/transition`, { data: { version, stageId: stages[2].id, ownerId: "codex", confirmed: true } });
    expect(rejected.ok()).toBe(false);
  }
  const after = await (await request.get(`/api/tickets/${ticket.id}`)).json();
  expect(after.stageId).toBe(ticket.stageId);
  expect(after.ownerId).toBe(ticket.ownerId);
  expect(after.execution).toBeFalsy();
});

for (const target of ["Planning", "Ready"]) {
  test(`creating ${target} captures Backlog until explicit confirmation`, async ({ page, request }) => {
    const response = await request.post("/api/projects", { data: { name: `Creation ${randomUUID()}`, key: `C${randomUUID().slice(0, 7)}` } });
    const project = await response.json();
    await page.route("**/api/integrations", route => route.fulfill({ json: { github: { available: false }, agents: [{ id: "codex", available: true }] } }));
    await page.goto("/");
    await page.getByRole("button", { name: /^New ticket/ }).click();
    const create = page.getByRole("dialog", { name: "New ticket" });
    await create.getByRole("combobox", { name: "Project", exact: true }).selectOption(project.id);
    const title = `Synthetic creation ${randomUUID()}`;
    await create.getByLabel("Title", { exact: true }).fill(title);
    await create.getByRole("combobox", { name: "Stage", exact: true }).selectOption({ label: target });
    await create.getByRole("button", { name: "Create ticket", exact: true }).click();
    const transition = page.getByRole("dialog", { name: target === "Planning" ? "Start planning" : "Move to Ready" });
    await expect(transition).toBeVisible();
    await transition.getByRole("button", { name: "Cancel", exact: true }).click();
    const state = await (await request.get("/api/state")).json();
    const ticket = state.tickets.find((item: any) => item.title === title);
    expect(state.stages.find((stage: any) => stage.id === ticket.stageId).role).toBe("backlog");
    expect(ticket.execution).toBeFalsy();
  });
}
