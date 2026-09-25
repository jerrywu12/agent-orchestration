import { realpathSync, lstatSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
export const PREPARATION_FIELDS = [
  "specification",
  "acceptanceCriteria",
  "scope",
  "verification",
  "allowedPaths",
  "conflictKeys",
];
const lines = (value) =>
  String(value ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
const containsSymlink = (root, path) => {
  if (!root) return false;
  let current = root;
  for (const part of path
    .replace(/\/\*\*$/, "")
    .split("/")
    .filter(Boolean)) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) return true;
    } catch {}
  }
  return false;
};
const canonicalRemote = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^git@([^:]+):/, "$1/")
    .replace(/^https?:\/\//, "")
    .replace(/^ssh:\/\/git@/, "")
    .replace(/\.git\/?$/, "")
    .replace(/\/$/, "");
export function repositoryIdentity(project) {
  const identities = [];
  if (project.repo)
    identities.push(
      `remote:${canonicalRemote(project.repo.includes("://") || project.repo.startsWith("git@") ? project.repo : `github.com/${project.repo}`)}`,
    );
  if (project.path) {
    let root;
    try {
      root = realpathSync(project.path);
    } catch {
      root = resolve(project.path);
    }
    identities.push(`path:${root}`);
    try {
      const common = execFileSync(
        "git",
        ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"],
        {
          encoding: "utf8",
          timeout: 1000,
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim();
      identities.push(`git:${realpathSync(common)}`);
    } catch {}
    try {
      const remote = execFileSync(
        "git",
        ["-C", root, "remote", "get-url", "origin"],
        {
          encoding: "utf8",
          timeout: 1000,
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim();
      identities.push(`remote:${canonicalRemote(remote)}`);
    } catch {}
  }
  return identities;
}
export function scopeSnapshot(
  ticket,
  project,
  repositories = repositoryIdentity(project),
) {
  const raw = lines(ticket.brief?.allowedPaths);
  const valid =
    raw.length > 0 &&
    raw.every(
      (p) =>
        !p.startsWith("/") &&
        !p.includes("//") &&
        !containsSymlink(project.path, p) &&
        !p.includes("\\") &&
        !/^[a-z]:/i.test(p) &&
        !p.split("/").some((s) => s === ".." || s === ".") &&
        !/[?\[\]{}]/.test(p) &&
        (!p.includes("*") ||
          (p.endsWith("/**") && !p.slice(0, -3).includes("*"))),
    );
  const keys = lines(ticket.brief?.conflictKeys).map((s) => s.toLowerCase());
  const validKeys =
    keys.length > 0 &&
    keys.every((s) => /^[a-z0-9][a-z0-9._:/-]*$/.test(s)) &&
    (!keys.includes("none") || keys.length === 1);
  return {
    repositories,
    paths: valid
      ? raw.map((p) => p.replace(/\/\*\*$/, "").replace(/\/$/, ""))
      : [],
    keys: validKeys ? keys.filter((k) => k !== "none") : [],
    unknown: !valid || !validKeys,
    invalidPaths: !valid,
    invalidKeys: !validKeys,
  };
}
export function inspectReadiness(service, ticket) {
  const store = service.store;
  const missing = PREPARATION_FIELDS.filter((k) => !ticket.brief?.[k]?.trim());
  const holds = [];
  const identities = new Map();
  const snapshot = (t) => {
    const p = service.require("project", t.projectId);
    if (!identities.has(p.id)) identities.set(p.id, repositoryIdentity(p));
    return scopeSnapshot(t, p, identities.get(p.id));
  };
  const scope = snapshot(ticket);
  if (!ticket.ownerId || !store.get("agent", ticket.ownerId)?.enabled)
    holds.push("Assign an enabled implementation agent before Ready admission.");
  if (!scope.repositories.length)
    holds.push("Configure a repository or project path.");
  if (scope.invalidPaths && !missing.includes("allowedPaths"))
    holds.push(
      "Allowed paths must be relative paths or terminal /** patterns without traversal, repeated separators or symlink components.",
    );
  if (scope.invalidKeys && !missing.includes("conflictKeys"))
    holds.push("Shared resource keys must be normalized identifiers or none.");
  if (ticket.archived) holds.push("Archived work cannot start.");
  if (ticket.blockedReason) holds.push(`Blocked: ${ticket.blockedReason}`);
  if (
    (ticket.dependsOn ?? []).some(
      (id) =>
        store.get("stage", store.get("ticket", id)?.stageId)?.role !== "done",
    )
  )
    holds.push("A dependency is unfinished.");
  if (store.list("ticket").some((t) => t.parentId === ticket.id))
    holds.push("Parent containers with children cannot launch implementation.");
  const conflicts = [];
  const tickets = store.list("ticket");
  const parents = new Set(tickets.map((t) => t.parentId).filter(Boolean));
  for (const other of tickets) {
    if (other.id === ticket.id) continue;
    const active = store.active(other.id);
    const role = store.get("stage", other.stageId)?.role;
    const reserved =
      active && !["planning", "resolve_blockers"].includes(active.purpose);
    if (parents.has(other.id) && !reserved) continue;
    if (
      !reserved &&
      (other.archived || !["ready", "active", "review"].includes(role))
    )
      continue;
    if (
      active &&
      ["planning", "resolve_blockers"].includes(active.purpose) &&
      role !== "ready" &&
      role !== "review"
    )
      continue;
    const latest = store.latest(other.id);
    const reviewSnapshot =
      role === "review" && latest?.purpose === "implementation"
        ? latest.scopeSnapshot
        : null;
    const competing = reserved
      ? (active.scopeSnapshot ?? snapshot(other))
      : (reviewSnapshot ?? snapshot(other));
    // Unknown repository identity is conservative for records within the same project.
    if (
      other.projectId !== ticket.projectId &&
      !scope.repositories.some((r) => competing.repositories?.includes(r))
    )
      continue;
    const reasons = [];
    if (
      scope.unknown ||
      competing.unknown ||
      (reserved && !active.scopeSnapshot)
    )
      reasons.push("Unknown reserved scope");
    for (const p of scope.paths)
      for (const q of competing.paths ?? [])
        if (p === q || p.startsWith(`${q}/`) || q.startsWith(`${p}/`))
          reasons.push(`Overlapping path: ${p} / ${q}`);
    for (const k of scope.keys)
      if (competing.keys?.includes(k)) reasons.push(`Shared resource: ${k}`);
    if (reasons.length)
      conflicts.push({
        ticketId: other.id,
        key: `${service.require("project", other.projectId).key}-${other.number}`,
        title: other.title,
        reasons: [...new Set(reasons)],
      });
  }
  return {
    ready: !missing.length && !holds.length && !conflicts.length,
    missing,
    holds,
    conflicts,
  };
}
