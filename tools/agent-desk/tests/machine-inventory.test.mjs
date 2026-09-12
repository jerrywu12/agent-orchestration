import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  rm,
  realpath,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  discoverMachine,
  probeMachine,
  machineDiscoveryPaths,
} from "../server/machine-inventory.mjs";
const hostInfo = () => ({
  name: "Fixture host",
  platform: "darwin",
  arch: "arm64",
  memoryTotalBytes: 8000000,
  memoryFreeBytes: 4000000,
  loadAverage: [1, 1, 1],
  uptimeSeconds: 100,
});

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "desk-machine-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (path, contents) => {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(
      join(root, path),
      typeof contents === "string" || Buffer.isBuffer(contents)
        ? contents
        : JSON.stringify(contents),
    );
    return join(root, path);
  };
  return {
    root,
    put,
    options: {
      home: root,
      appRoot: join(root, "apps"),
      platform: "darwin",
      paths: {},
    },
  };
}

test("bounded discovery retains duplicate installs and installed versus declared library provenance", async (t) => {
  const f = await fixture(t);
  await f.put("npm-a/@openai/codex/package.json", {
    name: "@openai/codex",
    version: "0.154.0",
    scripts: { postinstall: "PRIVATE_SCRIPT" },
  });
  await f.put("npm-b/@openai/codex/package.json", {
    name: "@openai/codex",
    version: "0.125.0",
  });
  await f.put("project/package.json", {
    name: "work",
    dependencies: {
      present: "^1.0.0",
      absent: "~2.0.0",
      remote: "https://PRIVATE_CREDENTIAL@example.invalid/package",
    },
  });
  await f.put("project/node_modules/present/package.json", {
    name: "present",
    version: "1.3.0",
    config: { token: "PRIVATE_TOKEN" },
  });
  await f.put(
    "project/requirements.txt",
    "openai>=2.0\n# PRIVATE_COMMENT\n-e git+https://PRIVATE_CREDENTIAL@example.invalid/repo\n",
  );
  await f.put(
    "venv/lib/python3.13/site-packages/mcp-1.2.dist-info/METADATA",
    "Metadata-Version: 2.4\nName: mcp\nVersion: 1.2.0\n\nPRIVATE_DESCRIPTION\n",
  );
  const options = {
    ...f.options,
    projects: [
      { id: "project", name: "Project", path: join(f.root, "project") },
    ],
    paths: {
      npmRoots: [join(f.root, "npm-a"), join(f.root, "npm-b")],
      venvRoots: [join(f.root, "venv")],
    },
  };
  const first = await discoverMachine(options);
  assert.equal(first.agents.filter((a) => a.deskAgentId === "codex").length, 2);
  assert.deepEqual(
    new Set(
      first.libraries
        .filter((l) => l.name === "@openai/codex")
        .map((l) => l.version),
    ),
    new Set(["0.154.0", "0.125.0"]),
  );
  assert.ok(
    first.libraries.some(
      (l) =>
        l.name === "present" &&
        l.status === "installed" &&
        l.version === "1.3.0",
    ),
  );
  assert.ok(
    first.libraries.some(
      (l) =>
        l.name === "absent" &&
        l.status === "declared" &&
        l.version === null &&
        l.requestedVersion === "~2.0.0",
    ),
  );
  assert.ok(
    first.libraries.some(
      (l) =>
        l.name === "openai" &&
        l.ecosystem === "python" &&
        l.status === "declared",
    ),
  );
  assert.ok(
    first.libraries.some(
      (l) =>
        l.name === "mcp" && l.status === "installed" && l.version === "1.2.0",
    ),
  );
  assert.ok(
    first.libraries.every((l) =>
      first.sources.some((s) => s.id === l.sourceId),
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(first),
    /PRIVATE_|postinstall|scripts|example\.invalid/,
  );
  const again = await discoverMachine(options);
  assert.deepEqual(first.agents, again.agents);
  assert.deepEqual(first.libraries, again.libraries);
});

test("application metadata supports binary plists, CLI aliases and cached IDE/tool manifests", async (t) => {
  const f = await fixture(t);
  await f.put(
    "apps/ChatGPT.app/Contents/Info.plist",
    Buffer.from(
      "YnBsaXN0MDDTAQIDBAUGXxASQ0ZCdW5kbGVFeGVjdXRhYmxlXxASQ0ZCdW5kbGVJZGVudGlmaWVyXxAaQ0ZCdW5kbGVTaG9ydFZlcnNpb25TdHJpbmdXQ2hhdEdQVF8QEGNvbS5vcGVuYWkuY29kZXhVMS4yLjMIDyQ5Vl5xAAAAAAAAAQEAAAAAAAAABwAAAAAAAAAAAAAAAAAAAHc=",
      "base64",
    ),
  );
  await f.put(
    "apps/Unknown.app/Contents/Info.plist",
    "<plist><dict><key>CFBundleIdentifier</key><string>example.editor</string></dict></plist>",
  );
  await f.put("npm/@moonshot-ai/kimi-code/package.json", {
    name: "@moonshot-ai/kimi-code",
    version: "0.39.1",
  });
  await f.put("bin-target/claude", "not invoked");
  await mkdir(join(f.root, "bin"));
  await symlink(join(f.root, "bin-target/claude"), join(f.root, "bin/claude"));
  await f.put("extensions/openai.chatgpt/package.json", {
    name: "chatgpt",
    publisher: "openai",
    version: "26.9.1",
    commands: "PRIVATE_COMMAND",
  });
  const result = await discoverMachine({
    ...f.options,
    paths: {
      appRoots: [join(f.root, "apps")],
      binRoots: [join(f.root, "bin")],
      npmRoots: [join(f.root, "npm")],
      extensionRoots: [join(f.root, "extensions")],
    },
  });
  assert.ok(
    result.agents.some(
      (a) =>
        a.deskAgentId === "codex" &&
        a.version === "1.2.3" &&
        a.path.endsWith("ChatGPT.app"),
    ),
  );
  assert.ok(
    result.agents.some(
      (a) => a.name.includes("Kimi") && a.version === "0.39.1",
    ),
  );
  assert.ok(
    result.agents.some(
      (a) => a.deskAgentId === "claude" && a.path.endsWith("bin-target/claude"),
    ),
  );
  assert.ok(
    result.libraries.some(
      (l) => l.name === "openai.chatgpt" && l.version === "26.9.1",
    ),
  );
  assert.ok(!result.agents.some((a) => a.path.includes("Unknown.app")));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
});

test("malformed, oversized, symlink and missing sources are bounded coverage failures without content leakage", async (t) => {
  const f = await fixture(t);
  await f.put("npm/bad/package.json", "{PRIVATE_BROKEN");
  await f.put("npm/large/package.json", "PRIVATE_OVERSIZE".repeat(100));
  await f.put("outside/package.json", { name: "outside", version: "1.0.0" });
  await mkdir(join(f.root, "npm/link"));
  await symlink(
    join(f.root, "outside/package.json"),
    join(f.root, "npm/link/package.json"),
  );
  const result = await discoverMachine({
    ...f.options,
    paths: { npmRoots: [join(f.root, "npm"), join(f.root, "missing")] },
    limits: { maxMetadataBytes: 128 },
  });
  assert.ok(result.sources.some((s) => s.status === "missing"));
  assert.ok(result.sources.some((s) => s.status === "partial"));
  assert.ok(result.issues.length > 0);
  assert.ok(!result.libraries.some((l) => l.name === "outside"));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|BROKEN|OVERSIZE/);
});

test("package/source budgets and cancellation stop discovery without arbitrary recursion", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 5; i++)
    await f.put(`npm/p${i}/package.json`, { name: `p${i}`, version: "1.0.0" });
  await f.put("custom/deep/nested/node_modules/hidden/package.json", {
    name: "hidden",
    version: "1.0.0",
  });
  const limited = await discoverMachine({
    ...f.options,
    paths: { npmRoots: [join(f.root, "npm")] },
    customSources: [{ id: "c", label: "Custom", path: join(f.root, "custom") }],
    limits: { maxPackages: 2 },
  });
  assert.equal(limited.libraries.length, 2);
  assert.equal(limited.truncated, true);
  assert.ok(limited.sources.some((s) => s.status === "partial"));
  assert.ok(!limited.libraries.some((l) => l.name === "hidden"));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    discoverMachine({ ...f.options, signal: controller.signal }),
    (e) => e.name === "AbortError",
  );
});

test("runtime uses fixed comm-only ps and attributes each PID once without generic-runtime or substring guesses", async () => {
  let invocation;
  const agents = [
    { id: "app", name: "Codex", path: "/fixture/ChatGPT.app", installed: true },
    {
      id: "native",
      name: "Codex CLI",
      path: "/fixture/bin/codex",
      installed: true,
    },
    {
      id: "alias",
      name: "Codex alias",
      path: "/fixture/bin/codex",
      installed: true,
    },
    {
      id: "cursor",
      name: "Cursor",
      path: "/fixture/Cursor.app",
      installed: true,
    },
    { id: "node", name: "Node", path: "/fixture/bin/node", installed: true },
  ];
  const result = await probeMachine({
    agents,
    platform: "darwin",
    hostInfo,
    runPs: async (options) => {
      invocation = options;
      return "10 2.5 100 /fixture/ChatGPT.app/Contents/MacOS/ChatGPT\n11 3.5 200 /fixture/bin/codex\n12 9.0 999 /fixture/bin/node\n13 1.0 999 /System/CursorUIViewService\n14 2.0 999 /fixture/ChatGPT.app-evil/Contents/MacOS/ChatGPT\n";
    },
    fetchImpl: async (url, options) => {
      assert.match(
        url,
        /^http:\/\/127\.0\.0\.1:\d+\/(?:api\/)?(?:health|version)$/,
      );
      assert.equal(options.redirect, "error");
      return { status: 200, body: { cancel: async () => {} } };
    },
  });
  assert.equal(invocation.command, "/bin/ps");
  assert.deepEqual(invocation.args, ["-ww", "-axo", "pid=,pcpu=,rss=,comm="]);
  assert.equal(result.agents.app.cpuPercent, 2.5);
  assert.equal(result.agents.app.memoryBytes, 102400);
  assert.equal(result.agents.cursor.processes.length, 0);
  assert.equal(result.agents.node.processes.length, 0);
  const processes = Object.values(result.agents).flatMap((a) => a.processes);
  assert.equal(processes.filter((p) => p.pid === 11).length, 1);
  assert.ok(result.services.every((s) => s.status === "healthy"));
  assert.equal(result.processError, null);
});

test("ps failure, malformed output, endpoint failure and ignored abort signals cannot become false idle or hang", async () => {
  const agents = [
    { id: "a", name: "Codex", path: "/fixture/bin/codex", installed: true },
  ];
  const result = await probeMachine({
    agents,
    platform: "darwin",
    hostInfo,
    healthTimeoutMs: 10,
    runPs: async () => {
      throw new Error("PRIVATE_PROCESS_ARGS");
    },
    fetchImpl: async () => new Promise(() => {}),
  });
  assert.equal(result.agents.a.status, "unknown");
  assert.equal(result.agents.a.cpuPercent, null);
  assert.ok(result.processError);
  assert.ok(result.services.every((s) => s.status === "unreachable"));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
  const malformed = await probeMachine({
    agents,
    platform: "darwin",
    hostInfo,
    runPs: async () => "PRIVATE_MALFORMED",
    fetchImpl: async () => ({ status: 302, body: { cancel: async () => {} } }),
  });
  assert.ok(malformed.processError);
  assert.ok(malformed.services.every((s) => s.status === "unreachable"));
});

test("dependency comments and non-version values are never treated as library requirements", async (t) => {
  const f = await fixture(t);
  await f.put("project/package.json", {
    dependencies: { safe: "^1.0", opaque: "PRIVATE_VALUE" },
  });
  await f.put(
    "project/pyproject.toml",
    '[project]\ndependencies = [\n "openai[async]>=2.0",\n # "PRIVATE_COMMENT"\n "mcp>=1.0",\n]\n[project.optional-dependencies]\ntest = ["pytest>=8"]\n',
  );
  const result = await discoverMachine({
    ...f.options,
    customSources: [{ id: "p", path: join(f.root, "project") }],
  });
  assert.ok(result.libraries.some((l) => l.name === "pytest"));
  assert.ok(result.libraries.some((l) => l.name === "openai"));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
});

test("non-regular metadata is refused before opening a FIFO", async (t) => {
  const f = await fixture(t);
  const folder = join(f.root, "npm/pipe");
  await mkdir(folder, { recursive: true });
  const fifo = join(folder, "package.json");
  execFileSync("/usr/bin/mkfifo", [fifo]);
  let neededWriter = false;
  const timer = setTimeout(() => {
    neededWriter = true;
    writeFile(fifo, "release blocked fixture").catch(() => {});
  }, 100);
  let result;
  try {
    result = await discoverMachine({
      ...f.options,
      paths: { npmRoots: [join(f.root, "npm")] },
    });
  } finally {
    clearTimeout(timer);
  }
  assert.equal(
    neededWriter,
    false,
    "opening a FIFO must not wait for a writer",
  );
  assert.ok(result.sources.some((s) => s.status === "partial"));
});

test("default Darwin paths keep application bundles separate from the service app root", () => {
  const paths = machineDiscoveryPaths({
    home: "/fixture/home",
    appRoot: "/fixture/runtime/agent-desk",
    platform: "darwin",
  });
  assert.ok(paths.appRoots.includes("/Applications"));
  assert.ok(!paths.appRoots.includes("/fixture/runtime/agent-desk"));
  assert.ok(paths.metadataRoots.includes("/fixture/runtime/agent-desk"));
});

test("one canonical folder requested as tools, project and custom does not create false declared duplicates", async (t) => {
  const f = await fixture(t);
  await f.put("project/package.json", { dependencies: { present: "^1.0" } });
  await f.put("project/node_modules/present/package.json", {
    name: "present",
    version: "1.2.0",
  });
  await f.put(
    "project/.venv/lib/python3.13/site-packages/openai-2.dist-info/METADATA",
    "Name: openai\nVersion: 2.0.0\n\n",
  );
  await f.put("project/requirements.txt", "openai>=2\n");
  const path = join(f.root, "project");
  const result = await discoverMachine({
    ...f.options,
    paths: { metadataRoots: [path], venvRoots: [join(path, ".venv")] },
    projects: [{ id: "p", name: "Project", path }],
    customSources: [{ id: "c", label: "Custom", path }],
  });
  assert.equal(result.sources.filter((s) => s.path === path).length, 1);
  assert.equal(result.libraries.filter((l) => l.name === "present").length, 1);
  assert.equal(result.libraries.filter((l) => l.name === "openai").length, 1);
  assert.ok(result.libraries.every((l) => l.status === "installed"));
});

test("cached plugin manifests are separate from installed npm packages", async (t) => {
  const f = await fixture(t);
  await f.put("cache/market/plugin/1.0/.codex-plugin/plugin.json", {
    name: "example-plugin",
    version: "1.0.0",
    config: { token: "PRIVATE_CONFIG" },
  });
  const result = await discoverMachine({
    ...f.options,
    paths: { pluginRoots: [join(f.root, "cache")] },
  });
  assert.equal(result.libraries.length, 1);
  assert.equal(result.libraries[0].status, "cached");
  assert.equal(result.libraries[0].ecosystem, "plugin");
  assert.equal(result.libraries[0].version, "1.0.0");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
});

test("Poetry declarations respect normalized installed package names in the same environment", async (t) => {
  const f = await fixture(t);
  await f.put(
    "project/.venv/lib/python3.13/site-packages/example_pkg-1.2.0.dist-info/METADATA",
    "Name: Example_Pkg\nVersion: 1.2.0\n\n",
  );
  await f.put(
    "project/pyproject.toml",
    "[tool.poetry.dependencies]\npython = '^3.13'\nexample-pkg = '^1.2.0'\nmissing-pkg = '^2.0'\n",
  );
  const result = await discoverMachine({
    ...f.options,
    customSources: [{ id: "p", path: join(f.root, "project") }],
  });
  const matching = result.libraries.filter(
    (library) =>
      library.name.toLowerCase().replace(/[-_.]/g, "-") === "example-pkg",
  );
  assert.equal(matching.length, 1);
  assert.equal(matching[0].status, "installed");
  assert.equal(matching[0].version, "1.2.0");
  assert.ok(
    result.libraries.some(
      (library) =>
        library.name === "missing-pkg" &&
        library.status === "declared" &&
        library.requestedVersion === "^2.0",
    ),
  );
});

test("prototype-shaped metadata names cannot abort known-agent discovery", async (t) => {
  const f = await fixture(t);
  for (const name of [
    "constructor",
    "__proto__",
    "toString",
    "ordinary-package",
    "@openai/codex",
  ]) {
    await f.put(`npm/${name}/package.json`, { name, version: "1.0.0" });
  }
  for (const name of ["constructor", "__proto__", "toString"]) {
    await f.put(
      `apps/${name}.app/Contents/Info.plist`,
      `<plist><dict><key>CFBundleIdentifier</key><string>${name}</string><key>CFBundleShortVersionString</key><string>1.0.0</string></dict></plist>`,
    );
  }
  const result = await discoverMachine({
    ...f.options,
    paths: {
      npmRoots: [join(f.root, "npm")],
      appRoots: [join(f.root, "apps")],
    },
  });
  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0].deskAgentId, "codex");
  for (const name of ["constructor", "toString", "ordinary-package"]) {
    assert.ok(
      result.libraries.some(
        (library) => library.name === name && library.status === "installed",
      ),
    );
  }
  assert.ok(!result.sources.some((source) => source.status === "error"));
});
