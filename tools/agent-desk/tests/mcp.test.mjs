import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
test("stdio MCP initializes and lists durable claim/progress tools without leaking tokens", async () => {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("../bin/mcp.mjs", import.meta.url)),
      "--agent",
      "codex",
    ],
    {
      env: { ...process.env, AGENT_DESK_TOKEN: "not-visible-in-protocol" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  child.stdin.end(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05" },
    }) +
      "\n" +
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) +
      "\n",
  );
  const code = await new Promise((r) => child.on("exit", r));
  assert.equal(code, 0, err);
  const lines = out.trim().split("\n").map(JSON.parse);
  assert.equal(lines[0].result.serverInfo.name, "agent-desk");
  assert.ok(lines[1].result.tools.some((t) => t.name === "desk_claim_task"));
  assert.ok(
    lines[1].result.tools.some((t) => t.name === "desk_report_progress"),
  );
  assert.ok(!out.includes("not-visible-in-protocol"));
});

test("stdio get_task returns assigned brief and extracted document context only", async (t) => {
  const { Store } = await import("../server/store.mjs");
  const { Service } = await import("../server/service.mjs");
  const { createAppServer } = await import("../server/http.mjs");
  const store = new Store(":memory:"),
    service = new Service(store),
    project = service.createProject({ name: "MCP fixture" });
  const attachment = service.attachments.save({
    name: "context.txt",
    bytes: Buffer.from("Reference context"),
    result: {
      text: "Reference context",
      warnings: [],
      mediaType: "text/plain",
    },
  });
  const ticket = service.createTicket({
    projectId: project.id,
    title: "Assigned",
    ownerId: "codex",
    attachmentIds: [attachment.id],
    brief: {
      acceptanceCriteria: "Visible result",
      scope: "src/**",
      verification: "npm test",
    },
  });
  const other = service.createTicket({
    projectId: project.id,
    title: "Other agent",
    ownerId: "claude",
  });
  const server = createAppServer({
    service,
    runner: { availability: () => [] },
    agentTokens: { codex: "fixture-scoped" },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
  });
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("../bin/mcp.mjs", import.meta.url)),
      "--agent",
      "codex",
    ],
    {
      env: {
        ...process.env,
        AGENT_DESK_TOKEN: "fixture-scoped",
        AGENT_DESK_URL: `http://127.0.0.1:${server.address().port}`,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let output = "",
    errors = "";
  child.stdout.on("data", (b) => (output += b));
  child.stderr.on("data", (b) => (errors += b));
  const timer = setTimeout(() => child.kill(), 10000);
  child.stdin.end(
    [ticket, other]
      .map((item, index) =>
        JSON.stringify({
          jsonrpc: "2.0",
          id: index + 1,
          method: "tools/call",
          params: { name: "desk_get_task", arguments: { ticketId: item.id } },
        }),
      )
      .join("\n") + "\n",
  );
  const code = await new Promise((r) => child.on("exit", r));
  clearTimeout(timer);
  assert.equal(code, 0, errors);
  const lines = output.trim().split("\n").map(JSON.parse);
  const context = JSON.parse(lines[0].result.content[0].text);
  assert.equal(context.brief.verification, "npm test");
  assert.equal(context.attachmentContext[0].text, "Reference context");
  assert.equal(lines[1].result.isError, true);
  assert.doesNotMatch(output, /fixture-scoped/);
});
