import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import * as os from "node:os";

// These are discovery ceilings, not traversal invitations. Each source uses only
// the fixed directory shapes below; package scripts and configuration are never read.
const DEFAULT_LIMITS = Object.freeze({
  maxSources: 128,
  maxPackages: 5000,
  maxAgents: 400,
  maxEntries: 20000,
  maxDirectoryEntries: 1200,
  maxFiles: 6000,
  maxMetadataBytes: 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
});
const identity = (...values) =>
  createHash("sha256")
    .update(JSON.stringify(values))
    .digest("hex")
    .slice(0, 24);
const packageName = (value) =>
  typeof value === "string" &&
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]{0,180}$/i.test(value)
    ? value
    : null;
const version = (value) =>
  typeof value === "string" && /^(?:v)?\d[A-Za-z0-9.+!_~-]{0,99}$/.test(value)
    ? value
    : null;
const requested = (value) =>
  typeof value === "string" &&
  value.length <= 120 &&
  /^[\d\s^~*<>=!|.,A-Za-z+_-]+$/.test(value) &&
  !/[\r\n]/.test(value) &&
  (/^[\s^~<>=!]*(?:v?\d|\*)/.test(value) ||
    ["latest", "next", "stable", "alpha", "beta", "canary"].includes(value))
    ? value
    : null;
const within = (root, path) => {
  const part = relative(root, path);
  return (
    part === "" ||
    (part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part))
  );
};
const cancelled = (signal) => {
  if (signal?.aborted)
    throw new DOMException("Machine observation cancelled", "AbortError");
};
class LimitReached extends Error {}
const definitions = {
  codex: ["Codex CLI", "agent", "codex"],
  claude: ["Claude Code", "agent", "claude"],
  gemini: ["Gemini CLI", "agent", "gemini"],
  agent: ["Cursor Agent", "agent", "cursor"],
  "cursor-agent": ["Cursor Agent", "agent", "cursor"],
  cursor: ["Cursor editor CLI", "tool", "cursor"],
  agy: ["Antigravity CLI", "agent", "antigravity"],
  hermes: ["Hermes", "agent", "hermes"],
  ollama: ["Ollama", "agent", "ollama"],
  arkcli: ["ArkCLI", "agent", "arkcli"],
  kimi: ["Kimi Code", "agent"],
  grok: ["Grok CLI", "agent"],
  cline: ["Cline", "agent"],
  openclaw: ["OpenClaw", "agent"],
  aider: ["Aider", "agent"],
  goose: ["Goose", "agent"],
  lms: ["LM Studio CLI", "tool"],
  specify: ["Spec Kit", "tool"],
  serena: ["Serena", "tool"],
  playwright: ["Playwright", "tool"],
  "playwright-mcp": ["Playwright MCP", "tool"],
  "chrome-devtools-mcp": ["Chrome DevTools MCP", "tool"],
  storybook: ["Storybook", "tool"],
  "storm-python": ["STORM", "tool"],
  "agent-deerflow-mcp": ["DeerFlow MCP", "tool"],
  "agent-desk": ["Agent Desk", "tool"],
  "agent-run": ["Agent Run", "tool"],
  graphify: ["Graphify", "tool"],
  notebooklm: ["NotebookLM CLI", "tool"],
  clawhub: ["ClawHub", "tool"],
  uv: ["uv", "tool"],
  node: ["Node.js", "tool"],
  python3: ["Python", "tool"],
  npm: ["npm", "tool"],
  pnpm: ["pnpm", "tool"],
  rtk: ["RTK", "tool"],
  "hermes-acp": ["Hermes ACP", "agent", "hermes"],
};
const npmAgents = {
  "@openai/codex": "codex",
  "@anthropic-ai/claude-code": "claude",
  "@google/gemini-cli": "gemini",
  "@volcengine/ark-cli": "arkcli",
  "@moonshot-ai/kimi-code": "kimi",
  "@xai-official/grok": "grok",
  cline: "cline",
  openclaw: "openclaw",
  playwright: "playwright",
  "@playwright/mcp": "playwright-mcp",
  "chrome-devtools-mcp": "chrome-devtools-mcp",
  storybook: "storybook",
  "graphify-ts": "graphify",
  clawhub: "clawhub",
};
const appDefinitions = {
  "com.openai.codex": ["Codex desktop", "agent", "codex"],
  "com.openai.chat": ["ChatGPT", "agent"],
  "com.anthropic.claudefordesktop": ["Claude desktop", "agent", "claude"],
  "com.google.antigravity-ide": ["Antigravity IDE", "agent", "antigravity"],
  "com.google.antigravity": ["Antigravity", "agent", "antigravity"],
  "com.todesktop.230313mzl4w4u92": ["Cursor", "agent", "cursor"],
  "com.nousresearch.hermes.setup": ["Hermes Setup", "tool"],
  "com.electron.ollama": ["Ollama desktop", "agent", "ollama"],
  "ai.elementlabs.lmstudio": ["LM Studio", "agent"],
  "com.kangentic.app": ["Kangentic (legacy)", "tool"],
};
const appNames = {
  "Hermes.app": ["Hermes desktop", "agent", "hermes"],
  "Codex.app": ["Codex desktop", "agent", "codex"],
  "Windsurf.app": ["Windsurf", "agent"],
  "Goose.app": ["Goose", "agent"],
  "Aider Desk.app": ["Aider Desk", "agent"],
  "Jan.app": ["Jan", "agent"],
  "Zed.app": ["Zed", "tool"],
};

function defaultPaths(home, appRoot, platform) {
  const shared = join(home, "agent-orchestrator");
  const brew =
    platform === "darwin" ? ["/opt/homebrew", "/usr/local"] : ["/usr/local"];
  return {
    appRoots:
      platform === "darwin"
        ? [
            "/Applications",
            join(home, "Applications"),
            join(home, ".hermes/hermes-agent/apps/desktop/release/mac-arm64"),
          ]
        : [],
    binRoots: [
      join(home, ".local/bin"),
      join(home, ".npm-global/bin"),
      join(home, ".volta/bin"),
      join(home, ".bun/bin"),
      join(home, ".lmstudio/bin"),
      ...brew.map((p) => join(p, "bin")),
      ...(platform === "darwin" ? ["/opt/homebrew/opt/gemini-cli/bin"] : []),
    ],
    npmRoots: [
      join(home, ".local/lib/node_modules"),
      join(home, ".npm-global/lib/node_modules"),
      join(home, ".local/share/npm/lib/node_modules"),
      join(home, ".hermes/node/lib/node_modules"),
      ...brew.map((p) => join(p, "lib/node_modules")),
      ...(platform === "darwin"
        ? ["/opt/homebrew/opt/gemini-cli/libexec/lib/node_modules"]
        : []),
    ],
    venvRoots: [
      join(home, ".hermes/hermes-agent/venv"),
      join(shared, "local/agent-home/deerflow/deer-flow/backend/.venv"),
      join(home, ".local/share/storm/venv"),
    ],
    uvRoots: [join(home, ".local/share/uv/tools")],
    nvmRoots: [join(home, ".nvm/versions/node")],
    fnmRoots: [join(home, ".local/share/fnm/node-versions")],
    metadataRoots: [
      appRoot,
      join(shared, "tools/open-source-ui-tooling"),
      join(shared, "tools/agent-desk"),
      join(home, ".hermes/hermes-agent"),
      join(home, ".hermes/hermes-agent/apps/desktop"),
      join(shared, "local/agent-home/deerflow/deer-flow/backend"),
      join(shared, "local/agent-home/deerflow/deer-flow/frontend"),
    ],
    extensionRoots: [
      join(home, ".vscode/extensions"),
      join(home, ".cursor/extensions"),
      join(home, ".antigravity-ide/extensions"),
    ],
    pluginRoots: [join(home, ".codex/plugins/cache")],
  };
}

export function machineDiscoveryPaths({ home, appRoot, platform }) {
  return defaultPaths(
    home,
    appRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    platform,
  );
}

// Plists are parsed as data, without launching plutil or a bundle executable.
// Only the root dictionary's selected strings are decoded from binary plists.
function plistStrings(buffer) {
  const keys = [
    "CFBundleIdentifier",
    "CFBundleShortVersionString",
    "CFBundleVersion",
  ];
  if (buffer.subarray(0, 8).toString() !== "bplist00") {
    const xml = buffer.toString("utf8");
    return Object.fromEntries(
      keys.map((key) => [
        key,
        xml
          .match(
            new RegExp(
              `<key>\\s*${key}\\s*</key>\\s*<string>([^<]{0,300})</string>`,
            ),
          )?.[1]
          ?.replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">"),
      ]),
    );
  }
  if (buffer.length < 40) throw new Error("Invalid metadata");
  const trailer = buffer.length - 32;
  const integer = (offset, size) => {
    if (size < 1 || size > 8 || offset < 0 || offset + size > buffer.length)
      throw new Error("Invalid metadata");
    let n = 0;
    for (let i = 0; i < size; i++) n = n * 256 + buffer[offset + i];
    if (!Number.isSafeInteger(n)) throw new Error("Invalid metadata");
    return n;
  };
  const offsetSize = buffer[trailer + 6],
    refSize = buffer[trailer + 7],
    count = integer(trailer + 8, 8),
    top = integer(trailer + 16, 8),
    offsets = integer(trailer + 24, 8);
  if (count > 10000 || top >= count || offsets + count * offsetSize > trailer)
    throw new Error("Invalid metadata");
  const object = (index) => {
    if (index >= count) throw new Error("Invalid metadata");
    const offset = integer(offsets + index * offsetSize, offsetSize);
    if (offset < 8 || offset >= offsets) throw new Error("Invalid metadata");
    const type = buffer[offset] >> 4;
    let length = buffer[offset] & 15,
      start = offset + 1;
    if (length === 15) {
      const marker = buffer[start++];
      if (marker >> 4 !== 1) throw new Error("Invalid metadata");
      const size = 2 ** (marker & 15);
      length = integer(start, size);
      start += size;
    }
    if (length > 10000) throw new Error("Invalid metadata");
    return { type, length, start };
  };
  const string = (index) => {
    const item = object(index);
    if (![5, 6].includes(item.type) || item.length > 300) return null;
    const size = item.type === 6 ? item.length * 2 : item.length;
    if (item.start + size > offsets) throw new Error("Invalid metadata");
    if (item.type === 5)
      return buffer.subarray(item.start, item.start + size).toString("utf8");
    const value = Buffer.from(buffer.subarray(item.start, item.start + size));
    value.swap16();
    return value.toString("utf16le");
  };
  const root = object(top);
  if (root.type !== 13 || root.start + root.length * refSize * 2 > offsets)
    throw new Error("Invalid metadata");
  const result = {};
  for (let i = 0; i < root.length; i++) {
    const key = string(integer(root.start + i * refSize, refSize));
    if (keys.includes(key))
      result[key] = string(
        integer(root.start + (root.length + i) * refSize, refSize),
      );
  }
  return result;
}

class Discovery {
  constructor(options) {
    this.signal = options.signal;
    this.limits = Object.fromEntries(
      Object.entries(DEFAULT_LIMITS).map(([key, max]) => [
        key,
        Number.isInteger(options.limits?.[key]) && options.limits[key] > 0
          ? Math.min(max, options.limits[key])
          : max,
      ]),
    );
    this.result = {
      agents: [],
      libraries: [],
      sources: [],
      issues: [],
      truncated: false,
    };
    this.entries = 0;
    this.files = 0;
    this.bytes = 0;
    this.seenSources = new Set();
    this.installedBySource = new Map();
    this.libraryIds = new Set();
    this.agentIds = new Set();
    this.npmCandidates = [];
  }
  check() {
    cancelled(this.signal);
  }
  issue(source, detail, limited = false) {
    if (source && source.status !== "error") {
      source.status = "partial";
      source.detail = detail;
    }
    if (!this.result.issues.includes(detail) && this.result.issues.length < 50)
      this.result.issues.push(detail);
    if (limited) this.result.truncated = true;
  }
  limit(source) {
    this.issue(
      source,
      "Discovery limit reached; additional metadata was skipped.",
      true,
    );
    throw new LimitReached();
  }
  async directory(path, source, optional = true) {
    this.check();
    try {
      const info = await lstat(path);
      if (
        info.isSymbolicLink() ||
        !info.isDirectory() ||
        !within(source.path, await realpath(path))
      ) {
        this.issue(source, "Unsafe metadata directory was skipped.");
        return [];
      }
      const entries = [];
      const directory = await opendir(path);
      for await (const entry of directory) {
        this.check();
        if (
          this.entries >= this.limits.maxEntries ||
          entries.length >= this.limits.maxDirectoryEntries
        ) {
          this.issue(
            source,
            "Directory entry limit reached; coverage is partial.",
            true,
          );
          break;
        }
        this.entries++;
        entries.push(entry);
        if (entry.isSymbolicLink())
          this.issue(source, "Symlinked directory entries were skipped.");
      }
      return entries.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      if (error.name === "AbortError" || error instanceof LimitReached)
        throw error;
      if (error.code !== "ENOENT" || !optional)
        this.issue(source, "A metadata directory could not be read.");
      return [];
    }
  }
  async read(path, source) {
    this.check();
    let handle;
    try {
      if (this.files >= this.limits.maxFiles) this.limit(source);
      if (!within(source.path, await realpath(dirname(path)))) {
        this.issue(
          source,
          "Metadata outside its registered source was skipped.",
        );
        return null;
      }
      const entry = await lstat(path);
      if (entry.isSymbolicLink() || !entry.isFile()) {
        this.issue(source, "Non-regular or symlinked metadata was skipped.");
        return null;
      }
      // O_NONBLOCK also prevents a swapped FIFO from blocking between lstat and open.
      handle = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      const info = await handle.stat();
      if (!info.isFile()) {
        this.issue(source, "Non-regular metadata was skipped.");
        return null;
      }
      if (info.size > this.limits.maxMetadataBytes) {
        this.issue(source, "Oversized metadata was skipped.", true);
        return null;
      }
      if (this.bytes + info.size > this.limits.maxTotalBytes)
        this.limit(source);
      this.files++;
      this.bytes += info.size;
      const data = Buffer.alloc(info.size + 1);
      const { bytesRead } = await handle.read(data, 0, data.length, 0);
      this.check();
      if (bytesRead > info.size) {
        this.issue(
          source,
          "Metadata changed during observation; it was skipped.",
        );
        return null;
      }
      return data.subarray(0, bytesRead);
    } catch (error) {
      if (error.name === "AbortError" || error instanceof LimitReached)
        throw error;
      if (error.code !== "ENOENT")
        this.issue(source, "Unreadable or symlinked metadata was skipped.");
      return null;
    } finally {
      await handle?.close();
    }
  }
  async json(path, source) {
    const data = await this.read(path, source);
    if (!data) return null;
    try {
      const value = JSON.parse(data.toString("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error();
      return value;
    } catch {
      this.issue(source, "Malformed metadata was skipped.");
      return null;
    }
  }
  async source(path, label, kind, callback) {
    this.check();
    if (this.result.sources.length >= this.limits.maxSources) {
      this.issue(
        null,
        "Source limit reached; additional folders were skipped.",
        true,
      );
      return;
    }
    if (typeof path !== "string" || !isAbsolute(path)) {
      this.issue(
        null,
        "A source lacked an absolute directory path and was skipped.",
      );
      return;
    }
    let actual = resolve(path),
      status = "scanned";
    try {
      actual = await realpath(path);
      if (!(await lstat(actual)).isDirectory()) status = "error";
    } catch (error) {
      status = error.code === "ENOENT" ? "missing" : "error";
    }
    const key = actual;
    if (this.seenSources.has(key)) return;
    this.seenSources.add(key);
    const source = {
      id: identity("source", key),
      label: String(label).slice(0, 80),
      path: actual,
      kind,
      status,
      packageCount: 0,
      detail:
        status === "missing"
          ? "Directory not present."
          : status === "error"
            ? "Directory unavailable."
            : null,
    };
    this.result.sources.push(source);
    if (status !== "scanned") return;
    try {
      await callback(actual, source);
    } catch (error) {
      if (error.name === "AbortError") throw error;
      if (!(error instanceof LimitReached)) {
        source.status = "error";
        source.detail = "Metadata discovery failed for this source.";
        this.issue(null, source.detail);
      }
    }
  }
  library(
    source,
    {
      name,
      version: installedVersion,
      requestedVersion,
      ecosystem,
      status,
      path,
    },
  ) {
    this.check();
    if (!packageName(name)) return;
    if (status === "installed") {
      if (!this.installedBySource.has(source.id))
        this.installedBySource.set(source.id, new Set());
      this.installedBySource
        .get(source.id)
        .add(this.installedKey(ecosystem, name));
    }
    const id = identity("library", ecosystem, path, name, status);
    if (this.libraryIds.has(id)) return;
    if (this.result.libraries.length >= this.limits.maxPackages)
      this.limit(source);
    this.libraryIds.add(id);
    this.result.libraries.push({
      id,
      name,
      version:
        status === "installed" || status === "cached"
          ? version(installedVersion)
          : null,
      ...(status === "declared"
        ? { requestedVersion: requested(requestedVersion) }
        : {}),
      ecosystem,
      sourceId: source.id,
      status,
      path,
    });
    source.packageCount++;
  }
  installedKey(ecosystem, name) {
    return `${ecosystem}:${ecosystem === "python" ? name.toLowerCase().replace(/[-_.]/g, "-") : name}`;
  }
  hasInstalled(source, ecosystem, name) {
    return (
      this.installedBySource
        .get(source.id)
        ?.has(this.installedKey(ecosystem, name)) ?? false
    );
  }
  agent(definition, path, installedVersion = null) {
    if (!definition) return;
    const [name, kind, deskAgentId] = definition,
      id = identity("installation", name, path);
    if (this.agentIds.has(id)) return;
    if (this.result.agents.length >= this.limits.maxAgents) {
      this.issue(null, "Agent installation limit reached.", true);
      return;
    }
    this.agentIds.add(id);
    this.result.agents.push({
      id,
      name,
      kind,
      installed: true,
      version: version(installedVersion),
      path,
      ...(deskAgentId ? { deskAgentId } : {}),
    });
  }
  async npm(root, source) {
    for (const entry of await this.directory(root, source)) {
      if (entry.isSymbolicLink()) {
        this.issue(source, "Symlinked package directories were skipped.");
        continue;
      }
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const candidates = entry.name.startsWith("@")
        ? (await this.directory(join(root, entry.name), source))
            .filter((p) => p.isDirectory())
            .map((p) => join(root, entry.name, p.name))
        : [join(root, entry.name)];
      for (const folder of candidates) {
        const path = join(folder, "package.json"),
          metadata = await this.json(path, source);
        if (!metadata || !packageName(metadata.name)) continue;
        this.library(source, {
          name: metadata.name,
          version: metadata.version,
          ecosystem: "npm",
          status: "installed",
          path,
        });
        if (npmAgents[metadata.name])
          this.npmCandidates.push({
            key: npmAgents[metadata.name],
            folder,
            version: metadata.version,
          });
      }
    }
  }
  async pythonPackages(root, source) {
    for (const entry of await this.directory(root, source)) {
      if (!entry.isDirectory() || !entry.name.endsWith(".dist-info")) continue;
      const path = join(root, entry.name, "METADATA"),
        data = await this.read(path, source);
      if (!data) continue;
      const headers = data.toString("utf8").split(/\r?\n\r?\n/, 1)[0];
      const name = headers.match(/^Name:\s*([^\r\n]+)$/m)?.[1],
        value = headers.match(/^Version:\s*([^\r\n]+)$/m)?.[1];
      if (name)
        this.library(source, {
          name,
          version: value,
          ecosystem: "python",
          status: "installed",
          path,
        });
    }
  }
  async venv(root, source) {
    const versions = await this.directory(join(root, "lib"), source);
    for (const entry of versions)
      if (entry.isDirectory() && /^python\d+(?:\.\d+)?$/.test(entry.name))
        await this.pythonPackages(
          join(root, "lib", entry.name, "site-packages"),
          source,
        );
    await this.pythonPackages(join(root, "Lib/site-packages"), source);
    if (basename(root) === "site-packages")
      await this.pythonPackages(root, source);
  }
  declaration(value, path, source) {
    const line = value.trim().split(/\s+#/, 1)[0].split(";", 1)[0].trim();
    if (!line || line.startsWith("#")) return;
    const match = line.match(
      /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[A-Za-z0-9,._ -]+\])?\s*([<>=!~].*)?$/,
    );
    if (!match || (match[2] && !requested(match[2]))) {
      this.issue(
        source,
        "Non-version Python dependency declarations were omitted.",
      );
      return;
    }
    if (!this.hasInstalled(source, "python", match[1]))
      this.library(source, {
        name: match[1],
        requestedVersion: match[2] ?? null,
        ecosystem: "python",
        status: "declared",
        path,
      });
  }
  async project(root, source) {
    if (basename(root) === "node_modules") await this.npm(root, source);
    else await this.npm(join(root, "node_modules"), source);
    await this.venv(root, source);
    await this.venv(join(root, ".venv"), source);
    await this.venv(join(root, "venv"), source);
    const manifest = join(root, "package.json"),
      metadata = await this.json(manifest, source);
    for (const [name, value] of Object.entries({
      ...metadata?.dependencies,
      ...metadata?.devDependencies,
      ...metadata?.optionalDependencies,
    })) {
      if (!packageName(name)) continue;
      if (!this.hasInstalled(source, "npm", name))
        this.library(source, {
          name,
          requestedVersion: value,
          ecosystem: "npm",
          status: "declared",
          path: manifest,
        });
    }
    for (const file of [
      "requirements.txt",
      "requirements-dev.txt",
      "requirements.in",
    ]) {
      const path = join(root, file),
        data = await this.read(path, source);
      if (data)
        for (const line of data.toString("utf8").split(/\r?\n/))
          this.declaration(line, path, source);
    }
    const path = join(root, "pyproject.toml"),
      data = await this.read(path, source);
    if (data) {
      const text = data.toString("utf8");
      for (const section of text.split(/(?=^\[)/m)) {
        if (/^\[project\]/.test(section))
          for (const value of dependencyArray(section, "dependencies"))
            this.declaration(value, path, source);
        if (/^\[project\.optional-dependencies\]/.test(section))
          for (const key of section.matchAll(/^([A-Za-z0-9_-]+)\s*=\s*\[/gm))
            for (const value of dependencyArray(section, key[1]))
              this.declaration(value, path, source);
        if (/^\[tool\.poetry\.dependencies\]/.test(section))
          for (const match of section.matchAll(
            /^([A-Za-z0-9_.-]+)\s*=\s*["']([^"'\r\n]+)["']/gm,
          ))
            if (match[1] !== "python" && requested(match[2]))
              this.library(source, {
                name: match[1],
                requestedVersion: match[2],
                ecosystem: "python",
                status: "declared",
                path,
              });
      }
    }
    source.detail ??=
      "Top-level package metadata and conventional environments; nested folders are not traversed.";
  }
}

function dependencyArray(text, key) {
  const match = new RegExp(`(?:^|\\n)${key}\\s*=\\s*\\[`).exec(text);
  if (!match) return [];
  const result = [];
  let quote = null,
    escaped = false,
    value = "";
  for (let i = match.index + match[0].length; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (escaped) {
        value += char;
        escaped = false;
      } else if (char === "\\") escaped = true;
      else if (char === quote) {
        result.push(value);
        quote = null;
        value = "";
      } else value += char;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "]") break;
    else if (char === "#") {
      const newline = text.indexOf("\n", i);
      if (newline < 0) break;
      i = newline;
    }
  }
  return result;
}

/** Read-only bounded discovery. Supplying `paths` replaces every default root
 * list, so deterministic fixtures cannot accidentally inspect the host. */
async function discover(options = {}) {
  const home = options.home ?? os.homedir(),
    platform = options.platform ?? os.platform();
  const paths =
    options.paths ??
    machineDiscoveryPaths({ home, appRoot: options.appRoot, platform });
  const scanner = new Discovery(options);
  scanner.check();
  for (const path of paths.appRoots ?? [])
    await scanner.source(
      path,
      "Application bundles",
      "apps",
      async (root, source) => {
        for (const entry of await scanner.directory(root, source)) {
          if (!entry.isDirectory() || !entry.name.endsWith(".app")) continue;
          const app = join(root, entry.name),
            data = await scanner.read(join(app, "Contents/Info.plist"), source);
          if (!data) continue;
          try {
            const info = plistStrings(data);
            scanner.agent(
              appDefinitions[info.CFBundleIdentifier] ?? appNames[entry.name],
              app,
              info.CFBundleShortVersionString ?? info.CFBundleVersion,
            );
          } catch {
            scanner.issue(
              source,
              "Malformed application metadata was skipped.",
            );
          }
        }
      },
    );
  for (const path of paths.binRoots ?? [])
    await scanner.source(
      path,
      "Known command locations",
      "tools",
      async (root, source) => {
        for (const name of Object.keys(definitions)) {
          scanner.check();
          try {
            const path = await realpath(join(root, name));
            if ((await lstat(path)).isFile())
              scanner.agent(
                definitions[name],
                path,
                name === "claude" ? basename(path) : null,
              );
          } catch (error) {
            if (!["ENOENT", "ENOTDIR"].includes(error.code))
              scanner.issue(
                source,
                "A known executable path could not be inspected.",
              );
          }
        }
      },
    );
  for (const path of paths.npmRoots ?? [])
    await scanner.source(path, "Global npm packages", "npm", (root, source) =>
      scanner.npm(root, source),
    );
  for (const path of paths.venvRoots ?? [])
    await scanner.source(
      path,
      "Known Python environment",
      "python",
      (root, source) => scanner.venv(root, source),
    );
  for (const path of paths.uvRoots ?? [])
    await scanner.source(
      path,
      "uv tool environments",
      "python",
      async (root, source) => {
        for (const entry of await scanner.directory(root, source))
          if (entry.isDirectory() && !entry.name.startsWith("."))
            await scanner.venv(join(root, entry.name), source);
      },
    );
  for (const [manager, roots] of [
    ["nvm", paths.nvmRoots],
    ["fnm", paths.fnmRoots],
  ])
    for (const path of roots ?? [])
      await scanner.source(
        path,
        `${manager} npm environments`,
        "npm",
        async (root, source) => {
          for (const entry of await scanner.directory(root, source))
            if (entry.isDirectory())
              await scanner.npm(
                join(
                  root,
                  entry.name,
                  manager === "fnm"
                    ? "installation/lib/node_modules"
                    : "lib/node_modules",
                ),
                source,
              );
        },
      );
  for (const path of paths.metadataRoots ?? [])
    await scanner.source(
      path,
      "Shared tooling metadata",
      "tools",
      (root, source) => scanner.project(root, source),
    );
  for (const project of options.projects ?? [])
    await scanner.source(
      project.path,
      project.name ?? "Registered project",
      "project",
      (root, source) => scanner.project(root, source),
    );
  for (const custom of (options.customSources ?? []).slice(0, 20))
    await scanner.source(
      custom.path,
      custom.label ?? "Additional library folder",
      "custom",
      (root, source) => scanner.project(root, source),
    );
  if ((options.customSources?.length ?? 0) > 20)
    scanner.issue(null, "Additional source limit reached.", true);
  for (const path of paths.extensionRoots ?? [])
    await scanner.source(
      path,
      "IDE extension metadata",
      "tools",
      async (root, source) => {
        for (const entry of await scanner.directory(root, source))
          if (entry.isDirectory() && !entry.name.startsWith(".")) {
            const path = join(root, entry.name, "package.json"),
              metadata = await scanner.json(path, source);
            if (
              metadata &&
              packageName(metadata.publisher) &&
              packageName(metadata.name)
            )
              scanner.library(source, {
                name: `${metadata.publisher}.${metadata.name}`,
                version: metadata.version,
                ecosystem: "npm",
                status: "installed",
                path,
              });
          }
        source.detail ??=
          "Extension files are present; enablement and runtime use are not inspected.";
      },
    );
  for (const path of paths.pluginRoots ?? [])
    await scanner.source(
      path,
      "Cached plugin metadata",
      "tools",
      async (root, source) => {
        for (const market of await scanner.directory(root, source))
          if (market.isDirectory())
            for (const plugin of await scanner.directory(
              join(root, market.name),
              source,
            ))
              if (plugin.isDirectory())
                for (const release of await scanner.directory(
                  join(root, market.name, plugin.name),
                  source,
                ))
                  if (release.isDirectory()) {
                    const path = join(
                        root,
                        market.name,
                        plugin.name,
                        release.name,
                        ".codex-plugin/plugin.json",
                      ),
                      metadata = await scanner.json(path, source);
                    if (metadata)
                      scanner.library(source, {
                        name: metadata.name,
                        version: metadata.version,
                        ecosystem: "plugin",
                        status: "cached",
                        path,
                      });
                  }
        source.detail ??=
          "Cached metadata only; installed/enabled plugin state and runtime use are unverified.";
      },
    );
  for (const candidate of scanner.npmCandidates) {
    const definition = definitions[candidate.key];
    const existing = scanner.result.agents.filter(
      (agent) =>
        agent.name === definition[0] && within(candidate.folder, agent.path),
    );
    if (existing.length)
      for (const agent of existing)
        agent.version ??= version(candidate.version);
    else scanner.agent(definition, candidate.folder, candidate.version);
  }
  scanner.check();
  scanner.result.agents.sort(
    (a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path),
  );
  scanner.result.libraries.sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      a.path.localeCompare(b.path) ||
      a.status.localeCompare(b.status),
  );
  return scanner.result;
}

export async function discoverMachine(options = {}) {
  const duration = Number.isFinite(options.maxDurationMs)
    ? Math.max(1, Math.min(30000, options.maxDurationMs))
    : 15000;
  return deadline(
    (signal) => discover({ ...options, signal }),
    duration,
    options.signal,
  );
}

const HEALTH_ENDPOINTS = Object.freeze([
  ["agent-desk", "Agent Desk", "http://127.0.0.1:4310/api/health"],
  ["deerflow", "DeerFlow", "http://127.0.0.1:8001/health"],
  ["hermes-web", "Hermes desktop backend", "http://127.0.0.1:9119/api/health"],
  ["hermes-api", "Hermes API (optional)", "http://127.0.0.1:8642/health"],
  ["ollama", "Ollama", "http://127.0.0.1:11434/api/version"],
]);
const hostSnapshot = (platform) => ({
  name: os.hostname(),
  platform,
  arch: os.arch(),
  memoryTotalBytes: os.totalmem(),
  memoryFreeBytes: os.freemem(),
  loadAverage: os.loadavg(),
  uptimeSeconds: os.uptime(),
});
const runProcessList = ({ command, args, timeout, maxBuffer, signal }) =>
  new Promise((resolve, reject) =>
    execFile(
      command,
      args,
      { encoding: "utf8", timeout, maxBuffer, signal, windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    ),
  );
async function deadline(work, milliseconds, signal) {
  cancelled(signal);
  const controller = new AbortController();
  let timer, onAbort;
  const stop = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Observation timed out"));
    }, milliseconds);
    onAbort = () => {
      controller.abort();
      reject(new DOMException("Machine observation cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => work(controller.signal)),
      stop,
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
function processMatch(agent, command) {
  const path = agent.path;
  if (
    typeof path !== "string" ||
    !isAbsolute(path) ||
    /^(?:node|python\d*(?:\.\d+)*)(?:\.exe)?$/i.test(basename(path))
  )
    return 0;
  if (path.endsWith(".app") && command.startsWith(`${path}/Contents/`))
    return path.length;
  if (command === path) return path.length + 10000;
  const packageRoot = path.match(
    /^(.*\/@openai\/codex)(?:\/bin\/codex\.js)?$/,
  )?.[1];
  if (
    packageRoot &&
    command.startsWith(`${packageRoot}/node_modules/@openai/codex-`) &&
    /\/vendor\/(?:aarch64|x86_64)-(?:apple-darwin|unknown-linux-musl)\/bin\/codex$/.test(
      command,
    )
  )
    return packageRoot.length;
  return 0;
}

/** Runtime evidence is comm-only OS metadata and fixed, non-redirecting local
 * liveness requests. Neither installed agents nor package code are executed. */
export async function probeMachine({
  agents = [],
  platform = os.platform(),
  signal,
  runPs = runProcessList,
  fetchImpl = globalThis.fetch,
  hostInfo = hostSnapshot,
  healthTimeoutMs = 1500,
} = {}) {
  cancelled(signal);
  let host;
  try {
    host = hostInfo(platform);
  } catch {
    throw new Error("Host resource metadata could not be observed.");
  }
  const result = {
    host,
    agents: {},
    services: [],
    issues: [],
    processError: null,
  };
  for (const agent of agents)
    result.agents[agent.id] = {
      status: "unknown",
      processes: [],
      cpuPercent: null,
      memoryBytes: null,
    };
  const processProbe = async () => {
    if (!["darwin", "linux"].includes(platform)) {
      result.processError =
        "Process observation is unsupported on this platform.";
      return;
    }
    try {
      const raw = await deadline(
        (innerSignal) =>
          runPs({
            command: "/bin/ps",
            args: ["-ww", "-axo", "pid=,pcpu=,rss=,comm="],
            timeout: 2500,
            maxBuffer: 2 * 1024 * 1024,
            signal: innerSignal,
          }),
        3000,
        signal,
      );
      const output = typeof raw === "string" ? raw : raw?.stdout;
      if (typeof output !== "string" || output.length > 2 * 1024 * 1024)
        throw new Error();
      const lines = output.split(/\r?\n/).filter(Boolean);
      if (!lines.length) throw new Error();
      const processes = [];
      let malformed = 0;
      for (const line of lines.slice(0, 10000)) {
        cancelled(signal);
        const match = line.match(/^\s*(\d+)\s+(\d+(?:\.\d+)?)\s+(\d+)\s+(.+)$/);
        if (!match) {
          malformed++;
          continue;
        }
        const pid = Number(match[1]),
          cpuPercent = Number(match[2]),
          memoryBytes = Number(match[3]) * 1024;
        if (
          !Number.isSafeInteger(pid) ||
          pid <= 0 ||
          !Number.isFinite(cpuPercent) ||
          !Number.isSafeInteger(memoryBytes)
        ) {
          malformed++;
          continue;
        }
        processes.push({ pid, cpuPercent, memoryBytes, command: match[4] });
      }
      if (!processes.length) throw new Error();
      if (malformed || lines.length > 10000)
        result.issues.push(
          "Some process metadata rows were skipped; runtime coverage is partial.",
        );
      for (const process of processes) {
        let best = null,
          score = 0;
        for (const agent of agents) {
          const candidate = processMatch(agent, process.command);
          if (
            candidate > score ||
            (candidate > 0 &&
              candidate === score &&
              agent.id.localeCompare(best.id) < 0)
          ) {
            best = agent;
            score = candidate;
          }
        }
        if (best) {
          const { command, ...metrics } = process;
          const values = result.agents[best.id].processes;
          if (!values.some((row) => row.pid === process.pid))
            values.push(metrics);
        }
      }
      for (const agent of agents) {
        const value = result.agents[agent.id];
        const generic = /^(?:node|python\d*(?:\.\d+)*)(?:\.exe)?$/i.test(
          basename(agent.path ?? ""),
        );
        value.status = value.processes.length
          ? "running"
          : generic
            ? "unknown"
            : "idle";
        value.cpuPercent = generic
          ? null
          : value.processes.reduce((sum, row) => sum + row.cpuPercent, 0);
        value.memoryBytes = generic
          ? null
          : value.processes.reduce((sum, row) => sum + row.memoryBytes, 0);
      }
    } catch (error) {
      cancelled(signal);
      result.processError =
        "Process metadata could not be observed; previous metrics may be stale.";
    }
  };
  const serviceProbe = async ([id, name, endpoint]) => {
    const started = performance.now();
    try {
      const status = await deadline(
        async (innerSignal) => {
          const response = await fetchImpl(endpoint, {
            method: "GET",
            redirect: "error",
            signal: innerSignal,
          });
          const status = response.status;
          await response.body?.cancel();
          return status;
        },
        Math.max(1, Math.min(5000, healthTimeoutMs)),
        signal,
      );
      const healthy = status >= 200 && status < 300;
      return {
        id,
        name,
        endpoint,
        status: healthy ? "healthy" : "unreachable",
        latencyMs: Math.round(performance.now() - started),
        detail: healthy
          ? "Local health endpoint responded; model/provider availability was not tested."
          : "Local health endpoint did not report success.",
      };
    } catch (error) {
      cancelled(signal);
      return {
        id,
        name,
        endpoint,
        status: "unreachable",
        latencyMs: null,
        detail: "Local health endpoint was unavailable or timed out.",
      };
    }
  };
  const [, services] = await Promise.all([
    processProbe(),
    Promise.all(HEALTH_ENDPOINTS.map(serviceProbe)),
  ]);
  result.services = services;
  cancelled(signal);
  return result;
}
