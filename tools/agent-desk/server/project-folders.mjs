import { realpath, stat, opendir } from "node:fs/promises";
import { isAbsolute, dirname, basename, join } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fail } from "./store.mjs";
const execute = promisify(execFile);
async function directory(path) {
  if (
    typeof path !== "string" ||
    !isAbsolute(path) ||
    path.length > 4096 ||
    /[\x00-\x1f\x7f]/.test(path)
  )
    fail(422, "FOLDER_PATH", "Choose an existing absolute server folder path.");
  try {
    const resolved = await realpath(path);
    if (!(await stat(resolved)).isDirectory()) throw Error();
    return resolved;
  } catch {
    fail(
      422,
      "FOLDER_UNAVAILABLE",
      "The selected server folder does not exist or is not accessible.",
    );
  }
}
export function githubRepoFromRemote(remote) {
  if (
    typeof remote !== "string" ||
    remote.length > 4096 ||
    /[\x00-\x20\x7f]/.test(remote)
  )
    return "";
  let pathname;
  const scp = remote.match(/^git@github\.com:([^?#]+)$/i);
  if (scp) pathname = scp[1];
  else {
    try {
      const url = new URL(remote);
      if (
        !["https:", "ssh:"].includes(url.protocol) ||
        url.hostname.toLowerCase() !== "github.com" ||
        url.search ||
        url.hash ||
        url.port
      )
        return "";
      pathname = url.pathname.replace(/^\//, "");
    } catch {
      return "";
    }
  }
  pathname = pathname.replace(/\.git$/i, "");
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(pathname) &&
    !pathname.split("/").some((p) => p === "." || p === "..")
    ? pathname
    : "";
}
async function git(root, args) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  try {
    const { stdout } = await execute(
      "git",
      [
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.hooksPath=/dev/null",
        "-C",
        root,
        ...args,
      ],
      {
        encoding: "utf8",
        timeout: 4000,
        maxBuffer: 512 * 1024,
        env: { ...env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
      },
    );
    return stdout.trim();
  } catch {
    return null;
  }
}
export async function inspectProjectFolder(path, projects = []) {
  let resolved = await directory(path);
  const inside = await git(resolved, ["rev-parse", "--is-inside-work-tree"]);
  const isRepository = inside === "true";
  const root = isRepository
    ? await git(resolved, ["rev-parse", "--show-toplevel"])
    : null;
  if (root) resolved = await directory(root);
  const warnings = [];
  let repo = "",
    branch = null,
    hasHead = false,
    dirty = false;
  if (isRepository) {
    const [remote, branchName, head, status, base] = await Promise.all([
      git(resolved, ["config", "--get", "remote.origin.url"]),
      git(resolved, ["symbolic-ref", "--short", "-q", "HEAD"]),
      git(resolved, ["rev-parse", "--verify", "HEAD"]),
      git(resolved, ["status", "--porcelain=v1", "--untracked-files=normal"]),
      git(resolved, ["rev-parse", "--verify", "refs/remotes/origin/main"]),
    ]);
    repo = githubRepoFromRemote(remote);
    branch = branchName || null;
    hasHead = !!head;
    dirty = status === null || !!status;
    if (!hasHead)
      warnings.push(
        "This repository has no commit yet; agent execution needs a committed base.",
      );
    if (!base)
      warnings.push(
        "Built-in execution needs a fetched origin/main base. Registering this folder does not fetch or change it.",
      );
    if (status === null)
      warnings.push(
        "Working-tree status could not be fully inspected. Treat it as containing local work.",
      );
    else if (dirty)
      warnings.push(
        "Local changes are present and will be preserved. Agents use isolated worktrees.",
      );
    if (!repo)
      warnings.push(
        "No supported GitHub origin was detected. You can enter owner/repository manually.",
      );
    if (hasHead && !branch) warnings.push("This checkout has a detached HEAD.");
  } else
    warnings.push(
      "This folder is not a Git working tree. It can hold tickets; built-in code execution needs a repository.",
    );
  let existingProjectId = null;
  for (const project of projects) {
    if (!project.path) continue;
    try {
      const registered = await realpath(project.path);
      if (registered === resolved) {
        existingProjectId = project.id;
        break;
      }
      // Historical registrations may point inside a repository. Probe only
      // descendants of this root, avoiding unrelated repository scans.
      if (isRepository && registered.startsWith(resolved + "/")) {
        const registeredRoot = await git(registered, [
          "rev-parse",
          "--show-toplevel",
        ]);
        if (registeredRoot && (await realpath(registeredRoot)) === resolved) {
          existingProjectId = project.id;
          break;
        }
      }
    } catch {}
  }
  const name = basename(resolved) || resolved;
  return {
    path: resolved,
    name,
    key:
      name
        .replace(/[^a-zA-Z]/g, "")
        .slice(0, 4)
        .toUpperCase() || "WORK",
    repo,
    git: {
      isRepository,
      root: isRepository ? resolved : null,
      branch,
      hasHead,
      dirty,
    },
    existingProjectId,
    warnings,
  };
}
export async function listProjectFolders(
  path = homedir(),
  { maxEntries = 200 } = {},
) {
  const root = await directory(path || homedir());
  const limit = Math.max(1, Math.min(200, maxEntries));
  const found = [];
  let examined = 0,
    truncated = false;
  try {
    const handle = await opendir(root);
    for await (const entry of handle) {
      if (++examined > 2000) {
        truncated = true;
        break;
      }
      if (
        !entry.name.startsWith(".") &&
        entry.isDirectory() &&
        !entry.isSymbolicLink()
      )
        found.push({ name: entry.name, path: join(root, entry.name) });
    }
  } catch {
    fail(422, "FOLDER_UNAVAILABLE", "This server folder cannot be listed.");
  }
  found.sort((a, b) => a.name.localeCompare(b.name));
  return {
    path: root,
    parentPath: dirname(root) === root ? null : dirname(root),
    directories: found.slice(0, limit),
    truncated: truncated || found.length > limit,
    nativePicker: process.platform === "darwin",
  };
}
let pickerActive = false;
async function nativeChoose() {
  try {
    const { stdout } = await execute(
      "/usr/bin/osascript",
      [
        "-e",
        'POSIX path of (choose folder with prompt "Choose an Agent Desk project folder")',
      ],
      { encoding: "utf8", timeout: 90000, maxBuffer: 8192 },
    );
    return stdout.trim();
  } catch (error) {
    if (String(error.stderr ?? "").includes("(-128)")) return null;
    fail(
      409,
      "PICKER_UNAVAILABLE",
      "The folder picker was unavailable or timed out. Use Browse server folders instead.",
    );
  }
}
export async function pickProjectFolder({
  platform = process.platform,
  choose = nativeChoose,
  projects = [],
} = {}) {
  if (platform !== "darwin")
    fail(
      409,
      "PICKER_UNAVAILABLE",
      "Native folder picker is available only on the server Mac. Use Browse server folders.",
    );
  if (pickerActive)
    fail(
      409,
      "PICKER_BUSY",
      "A folder picker is already open on the server Mac.",
    );
  pickerActive = true;
  try {
    const path = await choose();
    return path
      ? await inspectProjectFolder(path, projects)
      : { cancelled: true };
  } finally {
    pickerActive = false;
  }
}
