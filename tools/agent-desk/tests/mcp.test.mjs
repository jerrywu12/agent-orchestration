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
