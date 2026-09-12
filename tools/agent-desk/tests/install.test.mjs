import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  stat,
  readdir,
  symlink,
  lstat,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  previewInstall,
  applyInstall,
  rollbackInstall,
} from "../bin/install.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "agent-desk-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "operator's home");
  const source = join(root, "source");
  await mkdir(home);
  for (const directory of [
    "dist",
    "server",
    "bin",
    "node_modules/demo",
    "node_modules/.bin",
  ])
    await mkdir(join(source, directory), { recursive: true });
  for (const [path, content] of Object.entries({
    "dist/index.html": "<h1>Agent Desk</h1>",
    "server/http.mjs": "// server",
    "bin/desk.mjs": "// cli",
    "bin/mcp.mjs": "// mcp",
    "package.json": '{"name":"agent-desk"}',
    "package-lock.json": '{"lockfileVersion":3}',
    "node_modules/demo/index.js": "export default 1;",
  }))
    await writeFile(join(source, path), content);
  await symlink("../demo/index.js", join(source, "node_modules/.bin/demo"));
  const put = async (path, content, mode = 0o644) => {
    await mkdir(join(home, path, ".."), { recursive: true });
    await writeFile(join(home, path), content, { mode });
  };
  const options = { home, source, node: process.execPath, sha: "a".repeat(40) };
  return { root, home, source, put, options };
}

test("preview changes no files, inventories old references and excludes config values from output", async (t) => {
  const f = await fixture(t);
  await f.put(
    ".claude.json",
    JSON.stringify({
      privateSetting: "never-show-this-value",
      mcpServers: { kangentic: { command: "old-command" } },
    }),
  );
  const before = await readdir(f.home, { recursive: true });
  const preview = await previewInstall({ ...f.options, installSource: true });
  assert.equal(preview.mode, "preview");
  assert.ok(preview.changes.some((change) => change.kind === "release"));
  assert.ok(
    preview.legacyReferences.some((reference) =>
      reference.path.endsWith(".claude.json"),
    ),
  );
  assert.doesNotMatch(JSON.stringify(preview), /never-show-this-value/);
  assert.deepEqual(await readdir(f.home, { recursive: true }), before);
});

test("apply preserves unrelated JSON/TOML config and creates private backups and wrappers", async (t) => {
  const f = await fixture(t);
  const toml =
    'model = "custom-model"\n\n[mcp_servers.other]\ncommand = "keep-me"\n\n[projects."/tmp/example"]\ntrust_level = "trusted"\n';
  await f.put(".codex/config.toml", toml);
  await f.put(
    ".claude.json",
    JSON.stringify({
      theme: "dark",
      mcpServers: { other: { command: "keep-me" } },
    }),
  );
  await f.put(
    ".gemini/settings.json",
    JSON.stringify({ security: { auth: { selectedType: "oauth-personal" } } }),
  );
  const applied = await applyInstall(f.options);
  assert.equal(applied.mode, "applied");
  assert.ok(applied.manifestPath);
  assert.equal((await stat(applied.manifestPath)).mode & 0o777, 0o600);
  assert.equal(
    (await stat(join(applied.manifestPath, ".."))).mode & 0o777,
    0o700,
  );
  const claude = JSON.parse(
    await readFile(join(f.home, ".claude.json"), "utf8"),
  );
  assert.equal(claude.theme, "dark");
  assert.equal(claude.mcpServers.other.command, "keep-me");
  assert.deepEqual(claude.mcpServers.agent_desk.args, ["--agent", "claude"]);
  const codex = await readFile(join(f.home, ".codex/config.toml"), "utf8");
  assert.ok(codex.startsWith(toml));
  assert.match(codex, /\[mcp_servers\.agent_desk\]/);
  assert.deepEqual(
    JSON.parse(await readFile(join(f.home, ".gemini/settings.json"), "utf8"))
      .security.auth,
    { selectedType: "oauth-personal" },
  );
  for (const [path, agent] of [
    [".gemini/config/mcp_config.json", "antigravity"],
    [".cursor/mcp.json", "cursor"],
  ]) {
    const config = JSON.parse(await readFile(join(f.home, path), "utf8"));
    assert.deepEqual(config.mcpServers.agent_desk.args, ["--agent", agent]);
  }
  for (const path of [".local/bin/agent-desk", ".local/bin/agent-desk-mcp"]) {
    assert.equal((await stat(join(f.home, path))).mode & 0o777, 0o700);
    const wrapper = await readFile(join(f.home, path), "utf8");
    assert.match(wrapper, /^#!\/bin\/sh/);
    assert.ok(wrapper.includes(process.execPath));
    assert.doesNotMatch(wrapper, /AGENT_DESK_TOKEN|bearer|agent-tokens/);
  }
  const manifest = JSON.parse(await readFile(applied.manifestPath, "utf8"));
  const entry = manifest.entries.find((entry) =>
    entry.path.endsWith(".claude.json"),
  );
  assert.equal((await stat(entry.backupPath)).mode & 0o777, 0o600);
  assert.match(entry.before.hash, /^[a-f0-9]{64}$/);
  assert.match(entry.after.hash, /^[a-f0-9]{64}$/);
});

test("repeat install is byte-idempotent and does not create another backup generation", async (t) => {
  const f = await fixture(t);
  const first = await applyInstall(f.options);
  const before = await readFile(join(f.home, ".claude/CLAUDE.md"), "utf8");
  const second = await applyInstall(f.options);
  assert.equal(second.changes.length, 0);
  assert.equal(second.manifestPath, null);
  assert.equal(
    await readFile(join(f.home, ".claude/CLAUDE.md"), "utf8"),
    before,
  );
  assert.equal((before.match(/agent-desk:connector:start/g) ?? []).length, 1);
  assert.equal((await readdir(join(first.manifestPath, "..", ".."))).length, 1);
});

test("guidance replacement preserves global instructions and replaces only dedicated Cursor rule content", async (t) => {
  const f = await fixture(t);
  await f.put(
    ".claude/CLAUDE.md",
    "# Existing instructions\nKeep this exact text.\nRead /repo/docs/KANGENTIC_BOARD_POLICY.md\n",
  );
  await f.put(
    ".cursor/rules/kangentic-board-sync.mdc",
    "old Kangentic-only instructions",
  );
  await f.put(".cursor/rules/unrelated.mdc", "leave this alone");
  await applyInstall(f.options);
  const guidance = await readFile(join(f.home, ".claude/CLAUDE.md"), "utf8");
  assert.ok(
    guidance.startsWith(
      "# Existing instructions\nKeep this exact text.\nRead /repo/docs/AGENT_DESK_POLICY.md\n",
    ),
  );
  assert.match(guidance, /agent_desk/);
  assert.match(
    await readFile(
      join(f.home, ".cursor/rules/kangentic-board-sync.mdc"),
      "utf8",
    ),
    /Agent Desk/,
  );
  assert.equal(
    await readFile(join(f.home, ".cursor/rules/unrelated.mdc"), "utf8"),
    "leave this alone",
  );
});

test("source installation copies only runtime, preserves data and prepares a loopback service without starting it", async (t) => {
  const f = await fixture(t);
  await f.put(".local/share/agent-desk/desk.db", "existing database");
  await f.put(
    ".local/share/agent-desk/agent-tokens.json",
    '{"codex":"private-token"}',
  );
  await writeFile(join(f.source, "secret-local-data.db"), "must not be copied");
  const applied = await applyInstall({ ...f.options, installSource: true });
  const app = join(f.home, ".local/share/agent-desk/app");
  assert.equal(
    await readFile(join(app, "dist/index.html"), "utf8"),
    "<h1>Agent Desk</h1>",
  );
  assert.ok(
    (await lstat(join(app, "node_modules/.bin/demo"))).isSymbolicLink(),
  );
  await assert.rejects(stat(join(app, "secret-local-data.db")), {
    code: "ENOENT",
  });
  assert.equal(
    await readFile(join(f.home, ".local/share/agent-desk/desk.db"), "utf8"),
    "existing database",
  );
  assert.equal(
    await readFile(
      join(f.home, ".local/share/agent-desk/agent-tokens.json"),
      "utf8",
    ),
    '{"codex":"private-token"}',
  );
  assert.equal(
    JSON.parse(await readFile(join(app, "build-info.json"), "utf8")).sha,
    "a".repeat(40),
  );
  const plist = await readFile(
    join(f.home, "Library/LaunchAgents/local.agent.agent-desk.plist"),
    "utf8",
  );
  assert.match(plist, /127\.0\.0\.1/);
  assert.match(plist, /4310/);
  assert.ok(plist.includes(process.execPath));
  assert.doesNotMatch(plist, /private-token|ADMIN_TOKEN/);
  assert.ok(applied.changes.some((change) => change.path === app));
  assert.equal(
    (await applyInstall({ ...f.options, installSource: true })).changes.length,
    0,
  );
});

test("rollback restores exact original bytes/modes and removes only verified installed artifacts", async (t) => {
  const f = await fixture(t);
  const original = '{"theme":"original"}\n';
  await f.put(".claude.json", original, 0o640);
  const applied = await applyInstall({ ...f.options, installSource: true });
  const rolled = await rollbackInstall(applied.manifestPath);
  assert.equal(rolled.mode, "rolled-back");
  assert.equal(await readFile(join(f.home, ".claude.json"), "utf8"), original);
  assert.equal((await stat(join(f.home, ".claude.json"))).mode & 0o777, 0o640);
  await assert.rejects(stat(join(f.home, ".local/bin/agent-desk")), {
    code: "ENOENT",
  });
  await assert.rejects(stat(join(f.home, ".local/share/agent-desk/app")), {
    code: "ENOENT",
  });
  assert.equal(
    (await rollbackInstall(applied.manifestPath)).mode,
    "rolled-back",
  );
});

test("rollback refuses the entire operation when any post-install file was edited", async (t) => {
  const f = await fixture(t);
  const applied = await applyInstall(f.options);
  const wrapperPath = join(f.home, ".local/bin/agent-desk");
  const wrapper = await readFile(wrapperPath, "utf8");
  await writeFile(join(f.home, ".claude.json"), '{"newUserWork":true}');
  await assert.rejects(rollbackInstall(applied.manifestPath), {
    code: "ROLLBACK_CONFLICT",
  });
  assert.equal(await readFile(wrapperPath, "utf8"), wrapper);
  assert.equal(
    await readFile(join(f.home, ".claude.json"), "utf8"),
    '{"newUserWork":true}',
  );
});

test("invalid config blocks installation before any live target mutation", async (t) => {
  const f = await fixture(t);
  await f.put(".gemini/settings.json", "{invalid json");
  await assert.rejects(applyInstall(f.options), { code: "INVALID_CONFIG" });
  await assert.rejects(stat(join(f.home, ".local/bin/agent-desk")), {
    code: "ENOENT",
  });
  assert.equal(
    await readFile(join(f.home, ".gemini/settings.json"), "utf8"),
    "{invalid json",
  );
});

test("existing symlinked config remains a symlink and rollback restores its actual target", async (t) => {
  const f = await fixture(t);
  const originalPath = join(f.root, "shared-claude.json");
  await writeFile(originalPath, '{"existing":true}');
  await symlink(originalPath, join(f.home, ".claude.json"));
  const applied = await applyInstall(f.options);
  assert.ok((await lstat(join(f.home, ".claude.json"))).isSymbolicLink());
  assert.ok(
    JSON.parse(await readFile(originalPath, "utf8")).mcpServers.agent_desk,
  );
  await rollbackInstall(applied.manifestPath);
  assert.ok((await lstat(join(f.home, ".claude.json"))).isSymbolicLink());
  assert.equal(await readFile(originalPath, "utf8"), '{"existing":true}');
});

test("managed TOML replacement preserves following array tables and ignores triple quotes in comments", async (t) => {
  const f = await fixture(t);
  const unrelated =
    '[[notifications]]\nname = "keep"\ntext = """\n[mcp_servers.agent_desk]\nThis is string content.\n"""\n';
  await f.put(
    ".codex/config.toml",
    'model = "keep"\n[mcp_servers.agent_desk]\ncommand = "old"\n# Example uses triple quotes: """\n' +
      unrelated,
  );
  await applyInstall(f.options);
  const result = await readFile(join(f.home, ".codex/config.toml"), "utf8");
  assert.ok(result.includes(unrelated));
  assert.match(result, /model = "keep"/);
  assert.doesNotMatch(result, /command = "old"/);
});

test("upgrading an existing release can roll back to its exact prior runtime", async (t) => {
  const f = await fixture(t);
  await applyInstall({ ...f.options, installSource: true });
  await writeFile(join(f.source, "dist/index.html"), "<h1>Version two</h1>");
  const updated = await applyInstall({ ...f.options, installSource: true });
  assert.equal(
    await readFile(
      join(f.home, ".local/share/agent-desk/app/dist/index.html"),
      "utf8",
    ),
    "<h1>Version two</h1>",
  );
  await rollbackInstall(updated.manifestPath);
  assert.equal(
    await readFile(
      join(f.home, ".local/share/agent-desk/app/dist/index.html"),
      "utf8",
    ),
    "<h1>Agent Desk</h1>",
  );
  assert.ok(
    JSON.parse(await readFile(join(f.home, ".claude.json"), "utf8")).mcpServers
      .agent_desk,
  );
});

test("retired global board instructions and exact legacy MCP entries are replaced without affecting other sections", async (t) => {
  const f = await fixture(t);
  await f.put(
    ".claude/CLAUDE.md",
    "## Keep before\nUnrelated rule.\n## Kangentic Board Sync — All Projects\nOld credential and launch instructions.\n### Old nested rule\nOld.\n## Keep after\nAnother rule.\n",
  );
  await f.put(
    ".claude.json",
    JSON.stringify({
      mcpServers: {
        kangentic: { command: "old" },
        other: { command: "preserve" },
      },
    }),
  );
  await f.put(
    ".codex/config.toml",
    'model = "unchanged"\n[mcp_servers.kangentic]\ncommand = "old"\n[mcp_servers.other]\ncommand = "preserve"\n',
  );
  await applyInstall(f.options);
  const text = await readFile(join(f.home, ".claude/CLAUDE.md"), "utf8");
  assert.doesNotMatch(text, /Old credential|Old nested|Kangentic Board Sync/);
  assert.match(text, /Unrelated rule/);
  assert.match(text, /Another rule/);
  assert.equal(
    JSON.parse(await readFile(join(f.home, ".claude.json"), "utf8")).mcpServers
      .kangentic,
    undefined,
  );
  const toml = await readFile(join(f.home, ".codex/config.toml"), "utf8");
  assert.doesNotMatch(toml, /mcp_servers.kangentic/);
  assert.match(toml, /mcp_servers.other/);
  for (const path of [
    ".codex/AGENTS.md",
    ".gemini/GEMINI.md",
    ".hermes/AGENTS.md",
  ])
    assert.match(await readFile(join(f.home, path), "utf8"), /agent_desk/);
});

test("Hermes MCP installation preserves provider settings, comments and unrelated servers", async (t) => {
  const f = await fixture(t);
  await f.put(
    ".hermes/config.yaml",
    "# Preserve this operator note\nmodel: custom-model\nmcp:\n  auto_reload_on_config_change: false\nmcp_servers:\n  other:\n    command: keep-me\n",
  );
  await applyInstall(f.options);
  const content = await readFile(join(f.home, ".hermes/config.yaml"), "utf8");
  assert.match(content, /Preserve this operator note/);
  assert.match(content, /model: custom-model/);
  assert.match(content, /auto_reload_on_config_change: false/);
  assert.match(content, /command: keep-me/);
  assert.match(content, /agent_desk:/);
  assert.match(content, /hermes/);
  assert.equal((await applyInstall(f.options)).changes.length, 0);
});
