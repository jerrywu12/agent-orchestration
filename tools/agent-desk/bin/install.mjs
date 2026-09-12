#!/usr/bin/env node
import {
  readFile,
  mkdir,
  lstat,
  stat,
  readdir,
  readlink,
  realpath,
  cp,
  chmod,
  rename,
  rm,
  open,
} from "node:fs/promises";
import { homedir } from "node:os";
import { parseDocument, isMap } from "yaml";
import { resolve, dirname, join, isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

/**
 * Offline installer API (all async):
 * previewInstall(options) => {mode:'preview',home,source,node,appPath,dataDir,
 *   changes:[{path,targetPath,kind,operation,beforeHash,afterHash,mode}],
 *   unchanged:string[],legacyReferences:[{path,matches}]}
 * applyInstall(options) => same summary with mode:'applied', manifestPath:string|null.
 * rollbackInstall(manifestPath) => {mode:'rolled-back',manifestPath,restored:string[]}.
 *
 * options: {home=homedir(),source=<this app root>,node=process.execPath,
 *   installSource=false,policyPath=<home>/agent-orchestrator/docs/AGENT_DESK_POLICY.md,
 *   sha?}. All paths must be absolute. source is tools/agent-desk, not the repo root.
 * Without installSource only connectors, wrappers and bounded guidance are updated.
 * With installSource, copy dist/server/bin/package.json/package-lock.json/node_modules
 * and build-info.json into ~/.local/share/agent-desk/app; also write the LaunchAgent.
 * Database, tokens, sessions and logs are never copied, deleted or reconfigured.
 * No launchctl, service start, authentication or provider/network call is performed.
 *
 * CLI:
 * node bin/install.mjs preview|apply [--home ABS] [--source ABS] [--node ABS]
 *   [--install-source] [--policy ABS] [--sha COMMIT]
 * node bin/install.mjs rollback --manifest ABS
 *
 * Backups and manifests are private under ~/.local/state/agent-desk/installations/.
 * Config files are replaced atomically. A staged release replaces only the app tree.
 * Manifests enumerate before/after hashes, modes, actual symlink targets and backups.
 * Rollback checks EVERY target first; any later edit refuses the entire rollback.
 * Existing config symlinks remain intact. Invalid configs abort before any target write.
 * JSON preserves unrelated values; TOML preserves bytes outside the agent_desk table.
 */

const RUNTIME = [
  "dist",
  "server",
  "bin",
  "package.json",
  "package-lock.json",
  "node_modules",
];
const START = "<!-- agent-desk:connector:start -->";
const END = "<!-- agent-desk:connector:end -->";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const absent = () => ({ kind: "absent", hash: null, mode: null });
const equal = (left, right) =>
  left.kind === right.kind &&
  left.hash === right.hash &&
  left.mode === right.mode;
const shellQuote = (value) => `'${value.replaceAll("'", "'\"'\"'")}'`;
const xml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

export class InstallerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "InstallerError";
    this.code = code;
    Object.assign(this, details);
  }
}

async function exists(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function targetPath(path) {
  const suffix = [];
  let current = path;
  while (true) {
    try {
      return join(await realpath(current), ...suffix);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if ((await exists(current))?.isSymbolicLink())
        throw new InstallerError(
          "UNSAFE_PATH",
          "A configuration symlink has no valid target.",
          { path },
        );
      const parent = dirname(current);
      if (parent === current)
        throw new InstallerError(
          "UNSAFE_PATH",
          "Cannot resolve installation path.",
          { path },
        );
      suffix.unshift(relative(parent, current));
      current = parent;
    }
  }
}

async function treeEntries(path, prefix = "") {
  const info = await lstat(path);
  const mode = info.mode & 0o777;
  if (info.isSymbolicLink())
    return [
      { path: prefix, kind: "symlink", mode, link: await readlink(path) },
    ];
  if (info.isFile())
    return [
      { path: prefix, kind: "file", mode, hash: hash(await readFile(path)) },
    ];
  if (!info.isDirectory())
    throw new InstallerError(
      "INVALID_TARGET",
      "Only regular files, directories and runtime symlinks are supported.",
      { path },
    );
  const entries = [{ path: prefix, kind: "directory", mode }];
  for (const child of (await readdir(path)).sort())
    entries.push(
      ...(await treeEntries(
        join(path, child),
        prefix ? `${prefix}/${child}` : child,
      )),
    );
  return entries;
}

function treeHash(entries) {
  return hash(
    JSON.stringify([...entries].sort((a, b) => a.path.localeCompare(b.path))),
  );
}

async function fingerprint(path) {
  const info = await exists(path);
  if (!info) return absent();
  const mode = info.mode & 0o777;
  if (info.isFile())
    return { kind: "file", hash: hash(await readFile(path)), mode };
  if (info.isDirectory())
    return { kind: "directory", hash: treeHash(await treeEntries(path)), mode };
  if (info.isSymbolicLink())
    return { kind: "symlink", hash: hash(await readlink(path)), mode };
  throw new InstallerError(
    "INVALID_TARGET",
    "Unsupported installation target.",
    { path },
  );
}

async function atomicWrite(path, content, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.agent-desk-write-${randomUUID()}`);
  let handle;
  try {
    handle = await open(temporary, "wx", mode);
    await handle.chmod(mode);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, path);
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}

async function readText(path) {
  const info = await exists(path);
  if (!info) return "";
  if (!info.isFile())
    throw new InstallerError(
      "INVALID_CONFIG",
      "Configuration target must be a regular file.",
      { path },
    );
  return readFile(path, "utf8");
}

function updateJson(text, command, agent, path) {
  let value;
  try {
    value = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new InstallerError(
      "INVALID_CONFIG",
      "Invalid JSON configuration; no target files were changed.",
      { path },
    );
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value.mcpServers != null &&
      (typeof value.mcpServers !== "object" || Array.isArray(value.mcpServers)))
  )
    throw new InstallerError(
      "INVALID_CONFIG",
      "Unexpected MCP configuration structure.",
      { path },
    );
  if (value.mcpServers) delete value.mcpServers.kangentic;
  value.mcpServers = {
    ...(value.mcpServers ?? {}),
    agent_desk: { command, args: ["--agent", agent] },
  };
  return JSON.stringify(value, null, 2) + "\n";
}

function tableName(line) {
  const match = /^\s*(\[\[?)([^\[\]\r\n]+)(\]\]?)\s*(?:#.*)?$/.exec(line);
  if (!match) return null;
  if (match[1].length !== match[3].length) return null;
  return match[2]
    .trim()
    .replace(/"([A-Za-z0-9_-]+)"|'([A-Za-z0-9_-]+)'/g, (_, a, b) => a ?? b)
    .replace(/\s*\.\s*/g, ".");
}

function scanTomlLine(line, multiline) {
  for (let index = 0; index < line.length;) {
    if (multiline) {
      if (line.startsWith(multiline.repeat(3), index)) {
        multiline = null;
        index += 3;
      } else if (multiline === '"' && line[index] === "\\") index += 2;
      else index++;
    } else if (line[index] === "#") break;
    else if (line[index] === '"' || line[index] === "'") {
      const quote = line[index];
      if (line.startsWith(quote.repeat(3), index)) {
        multiline = quote;
        index += 3;
      } else {
        index++;
        while (index < line.length && line[index] !== quote)
          index += quote === '"' && line[index] === "\\" ? 2 : 1;
        index++;
      }
    } else index++;
  }
  return multiline;
}

function updateToml(text, command, path) {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const result = [];
  let skipping = false;
  let multiline = null;
  let currentTable = null;
  for (const line of lines) {
    const table = multiline ? null : tableName(line.trimEnd());
    if (table) {
      currentTable = table;
      skipping = ["mcp_servers.agent_desk", "mcp_servers.kangentic"].some(
        (name) => table === name || table.startsWith(name + "."),
      );
    }
    // Refuse unknown inline definitions without interpreting their values as code.
    if (
      !multiline &&
      ((!currentTable && /^\s*mcp_servers(?:\s*\.\s*[^=]+)?\s*=/.test(line)) ||
        (currentTable === "mcp_servers" &&
          /^\s*(?:agent_desk|"agent_desk"|'agent_desk')\s*=/.test(line)))
    )
      throw new InstallerError(
        "INVALID_CONFIG",
        "Inline MCP TOML configuration requires an explicit table before installation.",
        { path },
      );
    if (!skipping) result.push(line);
    // Table-looking lines inside TOML multiline strings are data, not configuration.
    multiline = scanTomlLine(line, multiline);
  }
  if (multiline)
    throw new InstallerError(
      "INVALID_CONFIG",
      "Unterminated TOML multiline string.",
      { path },
    );
  const preserved = result.join("");
  const separator = !preserved
    ? ""
    : preserved.endsWith("\n\n")
      ? ""
      : preserved.endsWith("\n")
        ? "\n"
        : "\n\n";
  return (
    preserved +
    separator +
    `[mcp_servers.agent_desk]\ncommand = ${JSON.stringify(command)}\nargs = ["--agent", "codex"]\n`
  );
}

function updateHermes(text, command, path) {
  const doc = parseDocument(text || "{}", { uniqueKeys: true });
  if (doc.errors.length || !isMap(doc.contents))
    throw new InstallerError(
      "INVALID_CONFIG",
      "Invalid Hermes YAML configuration; no targets changed.",
      { path },
    );
  const servers = doc.get("mcp_servers", true);
  if (servers && !isMap(servers))
    throw new InstallerError(
      "INVALID_CONFIG",
      "Hermes mcp_servers must be a mapping.",
      { path },
    );
  if (!servers) doc.set("mcp_servers", doc.createNode({}));
  doc.deleteIn(["mcp_servers", "kangentic"]);
  doc.setIn(
    ["mcp_servers", "agent_desk"],
    doc.createNode({
      command,
      args: ["--agent", "hermes"],
    }),
  );
  return String(doc);
}

function updateGuidance(text, policyPath) {
  // Retire only the known dedicated legacy section, including its nested headings.
  text = text.replace(
    /^## Kangentic Board Sync[^\n]*\n[\s\S]*?(?=^## |$(?![\s\S]))/gm,
    "",
  );
  text = text.replaceAll("KANGENTIC_BOARD_POLICY.md", "AGENT_DESK_POLICY.md");
  const notice = `${START}\n## Agent Desk board connector\n\nUse the stable \`agent_desk\` MCP server for Agent Desk tickets and exact execution ownership.\nRead the canonical policy at \`${policyPath}\`. Assignment and explicit Start are separate;\nkeep existing executor sessions intact and report checkpoints before handoff. Completion\nmeans ready for review; delivery needs verified merge evidence. If the connector is unavailable,\nretain the work and report the gap. Never reconstruct another application's session credentials.\n${END}`;
  if (text.includes(START) || text.includes(END)) {
    const start = text.indexOf(START);
    const end = text.indexOf(END);
    if (
      start < 0 ||
      end < start ||
      text.indexOf(START, start + START.length) !== -1 ||
      text.indexOf(END, end + END.length) !== -1
    )
      throw new InstallerError(
        "INVALID_CONFIG",
        "Ambiguous managed Agent Desk guidance block.",
      );
    return text.slice(0, start) + notice + text.slice(end + END.length);
  }
  return (
    text +
    (text
      ? text.endsWith("\n\n")
        ? ""
        : text.endsWith("\n")
          ? "\n"
          : "\n\n"
      : "") +
    notice +
    "\n"
  );
}

function cursorRule(policyPath) {
  return `---\ndescription: Agent Desk ticket ownership and progress\nalwaysApply: true\n---\n\n# Agent Desk\n\nRead the canonical policy at ${policyPath}.\nUse the agent_desk MCP server to read assigned work, claim the exact executor session,\nand report progress or checkpointed handoffs. Preserve existing active sessions.\nAssignment does not start an executor. Completion awaits review; delivery requires\nverified merge evidence. If the connector is unavailable, retain work and report the gap.\n`;
}

function wrapper(node, appPath, entry, dataDir) {
  return `#!/bin/sh\nexport AGENT_DESK_DATA_DIR=${shellQuote(dataDir)}\nexec ${shellQuote(node)} ${shellQuote(join(appPath, "bin", entry))} "$@"\n`;
}

function launchAgent(options) {
  const { node, appPath, dataDir } = options;
  const environment = {
    AGENT_DESK_HOST: "127.0.0.1",
    AGENT_DESK_PORT: "4310",
    AGENT_DESK_DATA_DIR: dataDir,
    PATH: `${dirname(node)}:${join(options.home, ".local/bin")}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>local.agent.agent-desk</string>\n<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(join(appPath, "server/http.mjs"))}</string></array>\n<key>WorkingDirectory</key><string>${xml(appPath)}</string>\n<key>EnvironmentVariables</key><dict>${Object.entries(
    environment,
  )
    .map(([key, value]) => `<key>${key}</key><string>${xml(value)}</string>`)
    .join(
      "",
    )}</dict>\n<key>RunAtLoad</key><true/>\n<key>KeepAlive</key><true/>\n<key>StandardOutPath</key><string>${xml(join(dataDir, "service.stdout.log"))}</string>\n<key>StandardErrorPath</key><string>${xml(join(dataDir, "service.stderr.log"))}</string>\n</dict></plist>\n`;
}

async function optionsFor(input = {}) {
  const options = {
    home: homedir(),
    source: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    node: process.execPath,
    installSource: false,
    ...input,
  };
  for (const key of ["home", "source", "node"])
    if (
      typeof options[key] !== "string" ||
      !isAbsolute(options[key]) ||
      options[key] === sep
    )
      throw new InstallerError(
        "INVALID_OPTIONS",
        "Installer paths must be explicit absolute paths.",
      );
  options.home = resolve(options.home);
  options.source = resolve(options.source);
  options.node = resolve(options.node);
  options.dataDir = join(options.home, ".local/share/agent-desk");
  options.appPath = join(options.dataDir, "app");
  options.policyPath ??= join(
    options.home,
    "agent-orchestrator/docs/AGENT_DESK_POLICY.md",
  );
  if (
    !isAbsolute(options.policyPath) ||
    (![undefined, null].includes(options.sha) &&
      !/^[a-f0-9]{40,64}$/.test(options.sha))
  )
    throw new InstallerError(
      "INVALID_OPTIONS",
      "Invalid policy path or source commit.",
    );
  if (!(await stat(options.node)).isFile())
    throw new InstallerError(
      "INVALID_OPTIONS",
      "The Node executable must be a file.",
    );
  return options;
}

async function releasePlan(options) {
  const target = await targetPath(options.appPath);
  if (
    (await exists(options.appPath))?.isSymbolicLink() ||
    (await targetPath(options.source)) === target
  )
    throw new InstallerError(
      "UNSAFE_PATH",
      "The release path must be a dedicated application directory, separate from source.",
    );
  const entries = [{ path: "", kind: "directory", mode: 0o700 }];
  const sources = [];
  for (const name of RUNTIME) {
    let path;
    try {
      path = await realpath(join(options.source, name));
    } catch {
      throw new InstallerError(
        "BUILD_REQUIRED",
        "Runtime source is incomplete; build and install dependencies before deployment.",
        { path: join(options.source, name) },
      );
    }
    const copiedEntries = await treeEntries(path, name);
    for (const entry of copiedEntries) {
      if (
        entry.kind === "symlink" &&
        (isAbsolute(entry.link) ||
          relative(
            options.appPath,
            resolve(options.appPath, dirname(entry.path), entry.link),
          ).startsWith(`..${sep}`))
      )
        throw new InstallerError(
          "UNSAFE_SOURCE_LINK",
          "A runtime symlink would escape the installed application.",
          { path: entry.path },
        );
    }
    entries.push(...copiedEntries);
    sources.push({ name, path });
  }
  let sha = options.sha;
  if (!sha) {
    try {
      sha = JSON.parse(
        await readFile(join(options.source, "build-info.json"), "utf8"),
      ).sha;
    } catch {}
    if (!/^[a-f0-9]{40,64}$/.test(sha ?? "")) {
      try {
        sha = execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: options.source,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 1000,
          maxBuffer: 1024,
        }).trim();
      } catch {
        sha = "unavailable";
      }
    }
  }
  const buildInfo =
    JSON.stringify({ sha, source: options.source }, null, 2) + "\n";
  entries.push({
    path: "build-info.json",
    kind: "file",
    mode: 0o600,
    hash: hash(buildInfo),
  });
  const before = await fingerprint(options.appPath);
  if (!["absent", "directory"].includes(before.kind))
    throw new InstallerError(
      "INVALID_TARGET",
      "The application release target is not a directory.",
    );
  return {
    path: options.appPath,
    targetPath: target,
    kind: "release",
    before,
    after: { kind: "directory", hash: treeHash(entries), mode: 0o700 },
    sources,
    buildInfo,
  };
}

async function makePlan(input) {
  const options = await optionsFor(input);
  const command = join(options.home, ".local/bin/agent-desk-mcp");
  const definitions = [
    [
      ".local/bin/agent-desk",
      () => wrapper(options.node, options.appPath, "desk.mjs", options.dataDir),
      0o700,
    ],
    [
      ".local/bin/agent-desk-mcp",
      () => wrapper(options.node, options.appPath, "mcp.mjs", options.dataDir),
      0o700,
    ],
    [".codex/config.toml", (text, path) => updateToml(text, command, path)],
    [".claude.json", (text, path) => updateJson(text, command, "claude", path)],
    [
      ".gemini/settings.json",
      (text, path) => updateJson(text, command, "gemini", path),
    ],
    [
      ".gemini/config/mcp_config.json",
      (text, path) => updateJson(text, command, "antigravity", path),
    ],
    [
      ".cursor/mcp.json",
      (text, path) => updateJson(text, command, "cursor", path),
    ],
    [".hermes/config.yaml", (text, path) => updateHermes(text, command, path)],
    [".claude/CLAUDE.md", (text) => updateGuidance(text, options.policyPath)],
    [".codex/AGENTS.md", (text) => updateGuidance(text, options.policyPath)],
    [".gemini/GEMINI.md", (text) => updateGuidance(text, options.policyPath)],
    [".hermes/AGENTS.md", (text) => updateGuidance(text, options.policyPath)],
    [
      (await exists(
        join(options.home, ".cursor/rules/kangentic-board-sync.mdc"),
      ))
        ? ".cursor/rules/kangentic-board-sync.mdc"
        : ".cursor/rules/agent-desk-board-sync.mdc",
      () => cursorRule(options.policyPath),
    ],
  ];
  if (options.installSource)
    definitions.push([
      "Library/LaunchAgents/local.agent.agent-desk.plist",
      () => launchAgent(options),
    ]);
  const artifacts = [];
  const legacyReferences = [];
  for (const [name, render, mode = 0o600] of definitions) {
    const path = join(options.home, name);
    const target = await targetPath(path);
    const before = await fingerprint(target);
    const text = await readText(target);
    const matches = (text.match(/kangentic/gi) ?? []).length;
    if (matches) legacyReferences.push({ path, matches });
    const content = render(text, path);
    artifacts.push({
      path,
      targetPath: target,
      kind: "file",
      before,
      after: { kind: "file", hash: hash(content), mode },
      content,
    });
  }
  if (options.installSource) artifacts.unshift(await releasePlan(options));
  const changed = artifacts.filter(
    (artifact) => !equal(artifact.before, artifact.after),
  );
  return {
    options,
    artifacts: changed,
    summary: {
      mode: "preview",
      home: options.home,
      source: options.source,
      node: options.node,
      appPath: options.appPath,
      dataDir: options.dataDir,
      changes: changed.map(({ path, targetPath, kind, before, after }) => ({
        path,
        targetPath,
        kind,
        operation: before.kind === "absent" ? "create" : "replace",
        beforeHash: before.hash,
        afterHash: after.hash,
        mode: after.mode,
      })),
      unchanged: artifacts
        .filter((artifact) => equal(artifact.before, artifact.after))
        .map((artifact) => artifact.path),
      legacyReferences,
    },
  };
}

export async function previewInstall(options = {}) {
  return (await makePlan(options)).summary;
}

async function swapDirectory(staging, target) {
  const previous = join(
    dirname(target),
    `.agent-desk-previous-${randomUUID()}`,
  );
  const hadPrevious = Boolean(await exists(target));
  if (hadPrevious) await rename(target, previous);
  try {
    await rename(staging, target);
  } catch (error) {
    if (hadPrevious) await rename(previous, target);
    throw error;
  }
  if (hadPrevious) await rm(previous, { recursive: true });
}

async function installRelease(artifact) {
  await mkdir(dirname(artifact.targetPath), { recursive: true, mode: 0o700 });
  const staging = join(
    dirname(artifact.targetPath),
    `.agent-desk-stage-${randomUUID()}`,
  );
  try {
    await mkdir(staging, { mode: 0o700 });
    await chmod(staging, 0o700);
    for (const source of artifact.sources)
      await cp(source.path, join(staging, source.name), {
        recursive: true,
        verbatimSymlinks: true,
        errorOnExist: true,
        force: false,
      });
    await atomicWrite(join(staging, "build-info.json"), artifact.buildInfo);
    if (!equal(await fingerprint(staging), artifact.after))
      throw new InstallerError(
        "SOURCE_CHANGED",
        "Runtime source changed during installation; the existing release was preserved.",
      );
    await swapDirectory(staging, artifact.targetPath);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function applyInstall(options = {}) {
  const plan = await makePlan(options);
  if (!plan.artifacts.length)
    return { ...plan.summary, mode: "applied", manifestPath: null };
  const history = join(
    plan.options.home,
    ".local/state/agent-desk/installations",
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`,
  );
  await mkdir(join(history, "backups"), { recursive: true, mode: 0o700 });
  await chmod(history, 0o700);
  await chmod(join(history, "backups"), 0o700);
  const manifestPath = join(history, "manifest.json");
  const manifest = {
    schemaVersion: 1,
    state: "prepared",
    createdAt: new Date().toISOString(),
    home: plan.options.home,
    source: plan.options.source,
    appPath: plan.options.appPath,
    entries: [],
  };
  const save = () =>
    atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  for (const [index, artifact] of plan.artifacts.entries()) {
    if (
      (await targetPath(artifact.path)) !== artifact.targetPath ||
      !equal(await fingerprint(artifact.targetPath), artifact.before)
    )
      throw new InstallerError(
        "INSTALL_CONFLICT",
        "A target changed after preview; no target was replaced.",
        { path: artifact.path },
      );
    const backupPath =
      artifact.before.kind === "absent"
        ? null
        : join(history, "backups", String(index));
    if (backupPath) {
      if (artifact.before.kind === "directory")
        await cp(artifact.targetPath, backupPath, {
          recursive: true,
          verbatimSymlinks: true,
          errorOnExist: true,
          force: false,
        });
      else await atomicWrite(backupPath, await readFile(artifact.targetPath));
      const backup = await fingerprint(backupPath);
      if (
        backup.kind !== artifact.before.kind ||
        backup.hash !== artifact.before.hash
      )
        throw new InstallerError(
          "INSTALL_CONFLICT",
          "A target changed while its backup was being made.",
          { path: artifact.path },
        );
    }
    manifest.entries.push({
      path: artifact.path,
      targetPath: artifact.targetPath,
      kind: artifact.kind,
      before: artifact.before,
      after: artifact.after,
      backupPath,
    });
  }
  await save();
  try {
    for (const artifact of plan.artifacts) {
      if (
        (await targetPath(artifact.path)) !== artifact.targetPath ||
        !equal(await fingerprint(artifact.targetPath), artifact.before)
      )
        throw new InstallerError(
          "INSTALL_CONFLICT",
          "A target changed during installation.",
          { path: artifact.path },
        );
      if (artifact.kind === "release") await installRelease(artifact);
      else
        await atomicWrite(
          artifact.targetPath,
          artifact.content,
          artifact.after.mode,
        );
    }
    manifest.state = "applied";
    manifest.appliedAt = new Date().toISOString();
    await save();
    return { ...plan.summary, mode: "applied", manifestPath };
  } catch (error) {
    manifest.state = "failed";
    manifest.errorCode = error.code ?? "INSTALL_FAILED";
    await save();
    try {
      await rollbackInstall(manifestPath);
    } catch {
      /* Keep manifest and backups for explicit recovery. */
    }
    error.manifestPath = manifestPath;
    throw error;
  }
}

export async function rollbackInstall(manifestPath) {
  if (typeof manifestPath !== "string" || !isAbsolute(manifestPath))
    throw new InstallerError(
      "INVALID_OPTIONS",
      "Rollback needs an absolute manifest path.",
    );
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new InstallerError(
      "INVALID_MANIFEST",
      "Cannot read the rollback manifest.",
    );
  }
  if (
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.entries) ||
    !isAbsolute(manifest.home ?? "")
  )
    throw new InstallerError(
      "INVALID_MANIFEST",
      "Unsupported rollback manifest.",
    );
  const pending = [];
  for (const entry of manifest.entries) {
    if (
      !isAbsolute(entry.path ?? "") ||
      !isAbsolute(entry.targetPath ?? "") ||
      !entry.before ||
      !entry.after
    )
      throw new InstallerError("INVALID_MANIFEST", "Invalid rollback entry.");
    const current = await fingerprint(entry.targetPath);
    if ((await targetPath(entry.path)) !== entry.targetPath)
      throw new InstallerError(
        "ROLLBACK_CONFLICT",
        "A configuration symlink changed after installation.",
        { path: entry.path },
      );
    if (equal(current, entry.before)) continue;
    if (!equal(current, entry.after))
      throw new InstallerError(
        "ROLLBACK_CONFLICT",
        "A target was edited after installation; no rollback targets were changed.",
        { path: entry.path },
      );
    if (entry.before.kind !== "absent") {
      if (!entry.backupPath)
        throw new InstallerError(
          "INVALID_MANIFEST",
          "A rollback backup is missing.",
        );
      const backup = await fingerprint(entry.backupPath);
      if (
        backup.kind !== entry.before.kind ||
        backup.hash !== entry.before.hash
      )
        throw new InstallerError(
          "INVALID_BACKUP",
          "A rollback backup changed; no rollback targets were changed.",
          { path: entry.path },
        );
    }
    pending.push(entry);
  }
  const restored = [];
  for (const entry of pending.reverse()) {
    // Recheck immediately before mutation to preserve user work during rollback too.
    if (!equal(await fingerprint(entry.targetPath), entry.after))
      throw new InstallerError(
        "ROLLBACK_CONFLICT",
        "A target changed while rollback was running.",
        { path: entry.path },
      );
    if (entry.before.kind === "absent")
      await rm(entry.targetPath, {
        recursive: entry.after.kind === "directory",
      });
    else if (entry.before.kind === "file")
      await atomicWrite(
        entry.targetPath,
        await readFile(entry.backupPath),
        entry.before.mode,
      );
    else {
      const staging = join(
        dirname(entry.targetPath),
        `.agent-desk-restore-${randomUUID()}`,
      );
      try {
        await cp(entry.backupPath, staging, {
          recursive: true,
          verbatimSymlinks: true,
          errorOnExist: true,
          force: false,
        });
        await swapDirectory(staging, entry.targetPath);
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    }
    restored.push(entry.path);
  }
  manifest.state = "rolled-back";
  manifest.rolledBackAt ??= new Date().toISOString();
  await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return { mode: "rolled-back", manifestPath, restored };
}

async function main(args) {
  const action = args.shift() ?? "preview";
  const options = {};
  let manifest;
  const names = {
    "--home": "home",
    "--source": "source",
    "--node": "node",
    "--policy": "policyPath",
    "--sha": "sha",
  };
  while (args.length) {
    const flag = args.shift();
    if (flag === "--install-source") options.installSource = true;
    else if (flag === "--manifest" && args[0]) manifest = args.shift();
    else if (names[flag] && args[0]) options[names[flag]] = args.shift();
    else
      throw new InstallerError(
        "INVALID_OPTIONS",
        "Usage: install.mjs preview|apply [--home ABS --source ABS --node ABS --install-source] or rollback --manifest ABS",
      );
  }
  if (!["preview", "apply", "rollback"].includes(action))
    throw new InstallerError(
      "INVALID_OPTIONS",
      "Choose preview, apply or rollback.",
    );
  const result =
    action === "rollback"
      ? await rollbackInstall(manifest)
      : action === "apply"
        ? await applyInstall(options)
        : await previewInstall(options);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      JSON.stringify({
        error: {
          code: error.code ?? "INSTALL_FAILED",
          message:
            error instanceof InstallerError
              ? error.message
              : "Agent Desk installation failed; existing recovery evidence was retained.",
          ...(error.manifestPath ? { manifestPath: error.manifestPath } : {}),
        },
      }) + "\n",
    );
    process.exitCode = 1;
  }
}
