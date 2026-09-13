import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function fixture(request: APIRequestContext, reserveOther: boolean) {
  const key = `AR${randomUUID().slice(0, 6)}`.toUpperCase();
  const projectResponse = await request.post("/api/projects", {
    data: { name: `Archive regression ${key}`, key, repo: `fixture/${key}` },
  });
  expect(projectResponse.status()).toBe(201);
  const project = await projectResponse.json();
  const state = await (await request.get("/api/state")).json();
  const stage = (role: string) =>
    state.stages.find((s: any) => s.projectId === project.id && s.role === role)
      .id;
  const tickets = [];
  for (let index = 0; index < 3; index++) {
    const response = await request.post("/api/tickets", {
      data: {
        projectId: project.id,
        title: `${key} ${index < 2 ? `Completed ${index + 1}` : "Unrelated work"}`,
        stageId: stage(index < 2 ? "done" : "ready"),
        ownerId: "codex",
        brief: {
          specification: "Synthetic archive regression",
          acceptanceCriteria: "Archive Done independently",
          scope: "Isolated fixture only",
          verification: "Playwright API/DOM assertions",
          allowedPaths: `fixtures/${key}/${index}`,
          conflictKeys: "none",
        },
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    tickets.push(await response.json());
  }
  let execution: any = null;
  if (reserveOther) {
    const response = await request.post(`/api/tickets/${tickets[2].id}/claim`, {
      data: { agentId: "codex", sessionId: `fixture-${randomUUID()}` },
    });
    expect(response.status(), await response.text()).toBe(201);
    execution = await response.json();
  }
  return { key, tickets, execution };
}

for (const mode of ["queued", "running", "mixed-active"] as const) {
  test(`Done tickets archive while an unrelated batch is ${mode}`, async ({
    page,
    request,
  }) => {
    const { key, tickets, execution } = await fixture(
      request,
      mode !== "queued",
    );
    const batchId = `archive-${randomUUID()}`;
    const writes: string[][] = [];
    const forbiddenStarts: string[] = [];
    await page.route("**/api/integrations", (route) =>
      route.fulfill({
        json: {
          github: { available: false, error: "Disabled in archive fixture" },
          agents: [],
          migration: { state: "not_imported" },
        },
      }),
    );
    await page.addInitScript((id) => {
      sessionStorage.setItem(
        "agent-desk:last-bulk-run:v1",
        JSON.stringify({ id, concurrency: 2 }),
      );
    }, batchId);
    await page.route(`**/api/runs/${batchId}`, (route) =>
      route.fulfill({
        json: {
          id: batchId,
          state: "running",
          concurrency: 2,
          createdAt: new Date().toISOString(),
          results: [
            {
              ticketId: tickets[2].id,
              executionId: execution?.id,
              status: mode === "queued" ? "queued" : "running",
              message: "Unrelated batch remains tracked",
            },
          ],
        },
      }),
    );
    await page.route("**/api/tickets/bulk-archive", (route) => {
      writes.push(route.request().postDataJSON().ticketIds);
      return route.continue();
    });
    await page.route(/\/api\/(runs$|tickets\/[^/]+\/start$)/, (route) => {
      if (route.request().method() === "POST") {
        forbiddenStarts.push(new URL(route.request().url()).pathname);
        return route.abort();
      }
      return route.continue();
    });
    await page.goto("/");
    await expect(
      page.getByText("Unrelated batch remains tracked", { exact: true }),
    ).toBeVisible();
    for (const ticket of mode === "mixed-active"
      ? tickets
      : tickets.slice(0, 2)) {
      await page
        .getByRole("checkbox", {
          name: `Select ticket ${key}-${ticket.number}`,
          exact: true,
        })
        .check();
    }
    const count = mode === "mixed-active" ? 3 : 2;
    await expect(
      page.getByText(`${count} selected`, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Archive selected tickets",
        exact: true,
      }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Archive selected tickets", exact: true })
      .click();
    expect(writes).toHaveLength(0);
    await page
      .getByRole("button", { name: `Archive ${count} tickets`, exact: true })
      .click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual(
      (mode === "mixed-active" ? tickets : tickets.slice(0, 2)).map(
        (t) => t.id,
      ),
    );
    await expect
      .poll(async () => {
        const state = await (await request.get("/api/state")).json();
        return tickets
          .slice(0, 2)
          .every((t) => state.tickets.find((v: any) => v.id === t.id).archived);
      })
      .toBe(true);
    const state = await (await request.get("/api/state")).json();
    const other = state.tickets.find((t: any) => t.id === tickets[2].id);
    expect(other.archived).toBe(false);
    if (execution) {
      expect(other.execution.id).toBe(execution.id);
      expect(other.execution.releasedAt).toBeNull();
    }
    if (mode === "mixed-active") {
      await expect(
        page.getByText(/Checkpoint active execution before archiving/),
      ).toBeVisible();
      await expect(
        page.getByRole("checkbox", {
          name: `Select ticket ${key}-${tickets[2].number}`,
          exact: true,
        }),
      ).toBeChecked();
    }
    await expect(
      page.getByRole("heading", { name: "Archive results", exact: true }),
    ).toHaveCount(0);
    expect(forbiddenStarts).toEqual([]);
    await page.reload();
    await expect(
      page.getByRole("button", { name: tickets[0].title, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Unrelated batch remains tracked", { exact: true }),
    ).toBeVisible();
  });
}
