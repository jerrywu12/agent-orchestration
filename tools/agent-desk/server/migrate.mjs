import { DatabaseSync, backup } from "node:sqlite";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { now } from "./store.mjs";
import { ensureProjectWorkflow, legacyRole, WORKFLOW } from "./workflow.mjs";

// Read only named columns. In particular, do not SELECT * from sessions or copy
// arbitrary JSON/config blobs: those contain commands, prompts and credentials.
const columns = {
  projects: [
    "id",
    "name",
    "path",
    "github_url",
    "default_agent",
    "default_model",
    "default_effort",
  ],
  swimlanes: [
    "id",
    "name",
    "role",
    "position",
    "color",
    "is_archived",
    "permission_mode",
    "auto_spawn",
    "agent_override",
    "model_override",
    "effort_override",
    "session_target",
    "session_spawn_strategy",
    "plan_exit_target_id",
  ],
  tasks: [
    "id",
    "title",
    "description",
    "swimlane_id",
    "position",
    "agent",
    "session_id",
    "worktree_path",
    "branch_name",
    "pr_number",
    "pr_url",
    "pr_state",
    "head_sha",
    "created_at",
    "updated_at",
    "archived_at",
    "base_branch",
    "pushed_branch",
    "resolved_base_branch",
    "use_worktree",
    "external_id",
    "external_source",
    "external_url",
    "display_id",
    "worktree_folder",
    "labels",
    "priority",
    "model_override",
    "effort_override",
    "agent_override",
    "permission_mode",
    "profile_id",
    "run_mode",
    "worktree_skip_reason",
  ],
  backlog_tasks: [
    "id",
    "title",
    "description",
    "priority",
    "labels",
    "position",
    "external_id",
    "external_source",
    "external_url",
    "sync_status",
    "attachment_count",
    "created_at",
    "updated_at",
    "assignee",
    "due_date",
    "item_type",
    "external_metadata",
  ],
  sessions: [
    "id",
    "task_id",
    "session_type",
    "agent_session_id",
    "cwd",
    "permission_mode",
    "status",
    "exit_code",
    "started_at",
    "suspended_at",
    "exited_at",
    "suspended_by",
    "model_id",
    "model_display_name",
    "applied_model",
    "applied_effort",
  ],
  task_attachments: [
    "id",
    "task_id",
    "filename",
    "file_path",
    "media_type",
    "size_bytes",
    "created_at",
  ],
  backlog_attachments: [
    "id",
    "backlog_task_id",
    "filename",
    "file_path",
    "media_type",
    "size_bytes",
    "created_at",
  ],
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sourceKey = (sourceId, kind, projectId, key) =>
  `kg-${hash(JSON.stringify([sourceId, kind, projectId, key])).slice(0, 40)}`;
const within = (root, path) => {
  const r = relative(root, path);
  return (
    r === "" || (!r.startsWith(`..${sep}`) && r !== ".." && !isAbsolute(r))
  );
};
const safeId = (value) => {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(value)
  )
    throw new Error("Unsafe source project ID.");
  return value;
};
const warn = (report, code, fields = {}) =>
  report.warnings.push({ code, ...fields });
const scalar = (value) =>
  ["string", "number", "boolean"].includes(typeof value) || value === null;
const pick = (row, keys) =>
  Object.fromEntries(
    keys
      .filter((k) => row[k] !== undefined && scalar(row[k]))
      .map((k) => [k, row[k]]),
  );

function sourceFile(root, ...parts) {
  const path = resolve(root, ...parts);
  if (!within(root, path) || lstatSync(path).isSymbolicLink())
    throw new Error(
      "Source database path is outside the source or is a symlink.",
    );
  const real = realpathSync(path);
  if (!within(root, real) || !lstatSync(real).isFile())
    throw new Error("Invalid source database path.");
  return real;
}
function openReadOnly(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN;");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
function backupRoot(sourceRoot, backupDir) {
  const requested = resolve(backupDir);
  let ancestor = requested;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const target = resolve(realpathSync(ancestor), relative(ancestor, requested));
  // Resolve an existing ancestor before mkdir: even a new leaf beneath an
  // external symlink must not be able to create anything in the source tree.
  if (within(sourceRoot, target))
    throw new Error("Backup directory resolves inside the source.");
  return target;
}
function unsupportedTables(db, allowed, report, projectId) {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'",
    )
    .all()
    .map((t) => t.name)
    .filter((t) => !allowed.includes(t));
  if (tables.length) warn(report, "UNSUPPORTED_TABLES", { projectId, tables });
}
function readTable(db, table, report, projectId, required = false) {
  const schema = db
    .prepare("SELECT type,sql FROM sqlite_master WHERE name=?")
    .get(table);
  if (!schema) {
    if (required) throw new Error(`Required source table missing: ${table}`);
    return [];
  }
  if (
    schema.type !== "table" ||
    /CREATE\s+VIRTUAL\s+TABLE/i.test(schema.sql ?? "")
  )
    throw new Error(`Unsupported source table: ${table}`);
  const actual = db
    .prepare(`PRAGMA table_info("${table}")`)
    .all()
    .map((c) => c.name);
  const allowed = columns[table].filter((c) => actual.includes(c));
  const unsupported = actual.filter((c) => !columns[table].includes(c));
  if (unsupported.length)
    warn(report, "UNSUPPORTED_FIELDS", {
      projectId,
      table,
      fields: unsupported,
    });
  if (!allowed.includes("id"))
    throw new Error(`Source table has no ID: ${table}`);
  return db
    .prepare(
      `SELECT ${allowed.map((c) => `"${c}"`).join(",")} FROM "${table}" ORDER BY id`,
    )
    .all();
}
async function inspect(sourceDir, { backupDir } = {}) {
  const root = realpathSync(sourceDir);
  if (!lstatSync(root).isDirectory())
    throw new Error("Source must be a directory.");
  const report = {
    sourceId: `kangentic-${hash(root).slice(0, 32)}`,
    counts: {
      projects: 0,
      stages: 0,
      tasks: 0,
      backlogItems: 0,
      sessions: 0,
      attachments: 0,
    },
    warnings: [],
    snapshotAt: now(),
  };
  let destination;
  if (backupDir !== undefined) {
    const path = backupRoot(root, backupDir);
    mkdirSync(path, { recursive: true, mode: 0o700 });
    if (within(root, realpathSync(path)))
      throw new Error("Backup directory resolves inside the source.");
    destination = mkdtempSync(join(path, "kangentic-"));
    chmodSync(destination, 0o700);
    mkdirSync(join(destination, "projects"), { mode: 0o700 });
    report.backup = {
      directory: destination,
      manifest: join(destination, "manifest.json"),
      files: [],
      consistency: "SQLite snapshot per database",
    };
  }
  const handles = [];
  try {
    const indexPath = sourceFile(root, "index.db");
    const index = openReadOnly(indexPath);
    handles.push(index);
    unsupportedTables(index, ["projects"], report, null);
    const projects = readTable(index, "projects", report, null, true);
    const bundles = [];
    for (const project of projects) {
      safeId(project.id);
      const path = sourceFile(root, "projects", `${project.id}.db`);
      const db = openReadOnly(path);
      handles.push(db);
      unsupportedTables(
        db,
        Object.keys(columns).filter((t) => t !== "projects"),
        report,
        project.id,
      );
      const bundle = { project };
      for (const table of Object.keys(columns).filter((t) => t !== "projects"))
        bundle[table] = readTable(
          db,
          table,
          report,
          project.id,
          table === "swimlanes" || table === "tasks",
        );
      bundles.push(bundle);
      if (destination) {
        const target = join(destination, "projects", `${project.id}.db`);
        await backup(db, target);
        chmodSync(target, 0o600);
        report.backup.files.push({
          source: path,
          snapshot: target,
          sha256: hash(readFileSync(target)),
        });
      }
      report.counts.projects++;
      report.counts.stages += bundle.swimlanes.length;
      report.counts.tasks += bundle.tasks.length;
      report.counts.backlogItems += bundle.backlog_tasks.length;
      report.counts.sessions += bundle.sessions.length;
      report.counts.attachments +=
        bundle.task_attachments.length + bundle.backlog_attachments.length;
    }
    if (destination) {
      const target = join(destination, "index.db");
      await backup(index, target);
      chmodSync(target, 0o600);
      report.backup.files.unshift({
        source: indexPath,
        snapshot: target,
        sha256: hash(readFileSync(target)),
      });
      writeFileSync(
        report.backup.manifest,
        JSON.stringify(
          {
            version: 1,
            sourceId: report.sourceId,
            sourceRoot: root,
            snapshotAt: report.snapshotAt,
            counts: report.counts,
            files: report.backup.files,
            consistency: report.backup.consistency,
          },
          null,
          2,
        ),
        { mode: 0o600, flag: "wx" },
      );
    }
    if (report.counts.attachments)
      warn(report, "ATTACHMENT_COPY_PENDING", {
        count: report.counts.attachments,
        message:
          "Attachment metadata and absolute source references are retained; file copying is pending.",
      });
    warn(report, "EXCLUDED_PRIVATE_DATA", {
      tables: ["session_transcripts", "session_messages_sent", "memory_chunks"],
      fields: ["prompt", "command", "auto_command", "configuration secrets"],
      message:
        "Original private source data remains only in the backup; excluded from imported records.",
    });
    return { root, report, bundles };
  } finally {
    for (const db of handles.reverse()) db.close();
  }
}

/** Async, read-only preview. Returns counts and warnings, never source row bodies. */
export async function previewKangentic(sourceDir) {
  return (await inspect(sourceDir)).report;
}

const text = (value) => (typeof value === "string" ? value : "");
const date = (value, fallback) =>
  typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : fallback;
const priority = (value) =>
  ["none", "urgent", "high", "medium", "low"][value] ??
  (["none", "urgent", "high", "medium", "low"].includes(value)
    ? value
    : "none");
const issueUrl = (value) =>
  text(value).match(
    /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/([1-9]\d*)\/?$/,
  );
const prUrl = (value) =>
  /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*\/?$/.test(
    text(value),
  )
    ? value
    : null;
function repository(value) {
  const match = text(value).match(
    /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/,
  );
  return match?.[1] ?? "";
}
function projectRepository(project) {
  const configured = repository(project.github_url);
  if (configured) return configured;
  if (!isAbsolute(text(project.path))) return "";
  // Fixed argv: this reads configuration only, never fetches or executes a hook.
  const result = spawnSync(
    "git",
    ["-C", project.path, "config", "--get", "remote.origin.url"],
    { encoding: "utf8", timeout: 2000, maxBuffer: 10000 },
  );
  return result.status === 0 ? repository(result.stdout.trim()) : "";
}
function sourceLabels(row, report, projectId) {
  try {
    const value =
      typeof row.labels === "string"
        ? JSON.parse(row.labels)
        : (row.labels ?? []);
    if (Array.isArray(value) && value.every((x) => typeof x === "string"))
      return value;
  } catch {}
  warn(report, "INVALID_LABELS", { projectId, sourceId: row.id });
  return [];
}
function ownership(row, labels, store, report, projectId) {
  const owners = labels.filter((x) => x.startsWith("owner:"));
  const candidate = owners.length === 1 ? owners[0].slice(6) : null;
  const ownerId =
    candidate && candidate !== "unassigned" && store.get("agent", candidate)
      ? candidate
      : null;
  const reasons = labels
    .filter((x) => x.startsWith("blocked:"))
    .map((x) => x.slice(8));
  if (!ownerId) {
    reasons.push(
      "Needs owner: imported ownership is missing, unknown or ambiguous",
    );
    warn(report, "OWNER_RECONCILIATION_REQUIRED", {
      projectId,
      sourceId: row.id,
    });
  }
  return { ownerId, blockedReason: reasons.join("; ") };
}
function stageRole(row, report, projectId) {
  if (
    [
      "backlog",
      "ready",
      "planning",
      "active",
      "review",
      "done",
      "parked",
    ].includes(row.role)
  )
    return legacyRole(row.role);
  const names = {
    "to do": "backlog",
    backlog: "backlog",
    ready: "ready",
    planning: "ready",
    executing: "active",
    "in progress": "active",
    "pr / code review": "review",
    "code review": "review",
    "in review": "review",
    done: "done",
    parked: "backlog",
  };
  const key = text(row.name).trim().replace(/\s+/g, " ").toLowerCase();
  const role = Object.hasOwn(names, key) ? names[key] : null;
  if (!role)
    warn(report, "UNMAPPED_STAGE_ROLE", {
      projectId,
      sourceId: row.id,
      message: "Unknown source stage is held in Backlog until reviewed.",
    });
  return role;
}
function metadata(row, table) {
  const result = pick(
    row,
    columns[table].filter((x) => x !== "external_metadata"),
  );
  // External JSON is an allowlist, never a raw blob (it may contain credentials).
  if (row.external_metadata) {
    try {
      result.external_metadata = pick(JSON.parse(row.external_metadata), [
        "repository",
        "prNumber",
        "issueNumber",
        "projectItemId",
        "status",
      ]);
    } catch {}
  }
  for (const key of ["external_url", "github_url", "pr_url"])
    if (result[key]) {
      try {
        const url = new URL(result[key]);
        if (url.protocol !== "https:" || url.username || url.password)
          delete result[key];
        else {
          url.search = "";
          url.hash = "";
          result[key] = url.href;
        }
      } catch {
        delete result[key];
      }
    }
  return result;
}
const unresolved = (session) =>
  !session.exited_at &&
  !["exited", "completed", "failed", "stopped", "cancelled"].includes(
    session.status,
  );

/** Async import. backupDir is required; source writes and dispatch are never performed. */
export async function importKangentic(service, sourceDir, { backupDir } = {}) {
  if (!backupDir)
    throw new Error("A private backupDir is required before import.");
  const { root, report, bundles } = await inspect(sourceDir, { backupDir });
  const store = service.store;
  const mappings = [];
  const created = { projects: 0, stages: 0, tickets: 0, executions: 0 };
  const skipped = { projects: 0, stages: 0, tickets: 0, executions: 0 };
  const mappingKey = (kind, pid, key) =>
    sourceKey(report.sourceId, kind, pid, key);
  const remember = (
    kind,
    pid,
    row,
    targetKind,
    targetId,
    table,
    extra = {},
  ) => {
    const key = mappingKey(kind, pid, row.id);
    const existing = store.get("migration-record", key);
    const mapping = existing?.mapping ?? {
      sourceKind: kind,
      sourceProjectId: pid,
      originalId: row.id,
      targetKind,
      targetId,
    };
    if (!existing)
      store.put("migration-record", {
        id: key,
        sourceId: report.sourceId,
        mapping,
        sourceRoot: root,
        sourceMetadata: metadata(row, table),
        importedAt: report.snapshotAt,
        ...extra,
      });
    mappings.push(mapping);
    return mapping;
  };
  const insert = (kind, pid, row, targetKind, value, table, counter) => {
    const key = mappingKey(kind, pid, row.id);
    const prior = store.get("migration-record", key);
    if (prior) {
      skipped[counter]++;
      remember(kind, pid, row, targetKind, prior.mapping.targetId, table);
      return {
        value: store.get(targetKind, prior.mapping.targetId),
        created: false,
      };
    }
    if (store.get(targetKind, value.id))
      throw new Error(
        "Migration target identity already exists without a source mapping.",
      );
    const result = store.put(targetKind, value);
    created[counter]++;
    remember(kind, pid, row, targetKind, result.id, table);
    return { value: result, created: true };
  };
  store.transaction(() => {
    for (const bundle of bundles) {
      const source = bundle.project;
      const pid = source.id;
      const projectId = mappingKey("project", pid, pid);
      const project = insert(
        "project",
        pid,
        source,
        "project",
        {
          id: projectId,
          name: text(source.name) || "Imported project",
          key: (
            text(source.name)
              .replace(/[^A-Za-z]/g, "")
              .slice(0, 8) || "IMPORT"
          ).toUpperCase(),
          path: isAbsolute(text(source.path)) ? source.path : "",
          repo: projectRepository(source),
          githubProjectNumber: null,
          createdAt: report.snapshotAt,
        },
        "projects",
        "projects",
      ).value;
      if (!project)
        throw new Error(
          "An imported project was deleted locally; explicit reconciliation is required.",
        );
      const stages = new Map();
      const sourceRoles = new Map(
        bundle.swimlanes.map((row) => [row.id, stageRole(row, report, pid)]),
      );
      const beforeStages = store.list("stage", project.id);
      // A first import retains source IDs for surviving roles. Later imports map
      // directly to the canonical stages and cannot resurrect retired IDs.
      if (!beforeStages.length) {
        for (const definition of WORKFLOW) {
          const candidates = bundle.swimlanes.filter(
            (row) =>
              sourceRoles.get(row.id) === definition.role &&
              row.role !== "parked" &&
              text(row.name).trim().toLowerCase() !== "parked",
          );
          const row =
            candidates.find((row) => row.role === definition.role) ??
            candidates[0];
          if (row) {
            const stageId = mappingKey("stage", pid, row.id);
            if (store.get("stage", stageId))
              throw new Error(
                "Migration target identity already exists without a source mapping.",
              );
            store.put("stage", {
              id: stageId,
              projectId: project.id,
              ...definition,
              position: WORKFLOW.indexOf(definition),
              autoStart: false,
            });
          }
        }
      }
      const canonical = ensureProjectWorkflow(store, project.id);
      created.stages += Math.max(0, canonical.length - beforeStages.length);
      for (const row of bundle.swimlanes) {
        const prior = store.get(
          "migration-record",
          mappingKey("stage", pid, row.id),
        );
        if (prior) skipped.stages++;
        const role = sourceRoles.get(row.id) ?? "backlog";
        const target = prior
          ? store.get("stage", prior.mapping.targetId)
          : canonical.find((stage) => stage.role === role);
        if (!target)
          throw new Error(
            "A source stage mapping requires explicit reconciliation.",
          );
        remember("stage", pid, row, "stage", target.id, "swimlanes");
        stages.set(row.id, target);
      }
      const backlogStage = canonical[0];
      const fallback = () => backlogStage;
      const tickets = new Map();
      const fresh = new Set();
      const numbers = new Set(
        store.list("ticket", project.id).map((t) => t.number),
      );
      for (const [kind, table, rows] of [
        ["task", "tasks", bundle.tasks],
        ["backlog", "backlog_tasks", bundle.backlog_tasks],
      ]) {
        for (const row of rows) {
          const labels = sourceLabels(row, report, pid);
          const owner = ownership(row, labels, store, report, pid);
          if (
            row.priority !== null &&
            row.priority !== undefined &&
            ![
              "none",
              "urgent",
              "high",
              "medium",
              "low",
              0,
              1,
              2,
              3,
              4,
            ].includes(row.priority)
          )
            warn(report, "UNSUPPORTED_PRIORITY", {
              projectId: pid,
              sourceId: row.id,
              message: "Priority retained privately and normalized to none.",
            });
          const stage =
            (kind === "task" ? stages.get(row.swimlane_id) : backlogStage) ??
            fallback();
          if (
            kind === "task" &&
            (!stages.has(row.swimlane_id) || !sourceRoles.get(row.swimlane_id))
          ) {
            owner.blockedReason = [
              owner.blockedReason,
              "Source stage needs reconciliation",
            ]
              .filter(Boolean)
              .join("; ");
            warn(report, "MISSING_SOURCE_STAGE", {
              projectId: pid,
              sourceId: row.id,
            });
          }
          let number =
            Number.isSafeInteger(row.display_id) &&
            row.display_id > 0 &&
            !numbers.has(row.display_id)
              ? row.display_id
              : Math.max(0, ...numbers) + 1;
          numbers.add(number);
          const match = issueUrl(row.external_url);
          let github = null;
          if (match && match[1] === project.repo)
            github = {
              number: Number(match[2]),
              url: row.external_url,
              state: "open",
              baseline: null,
              dirty: false,
              syncState: "imported",
            };
          else if (match)
            warn(report, "ISSUE_REPOSITORY_MISMATCH", {
              projectId: pid,
              sourceId: row.id,
            });
          const value = {
            id: mappingKey(kind, pid, row.id),
            projectId: project.id,
            number,
            title: text(row.title) || "Untitled imported ticket",
            description: text(row.description),
            stageId: stage.id,
            ...owner,
            priority: priority(row.priority),
            labels,
            parentId: null,
            dependsOn: [],
            archived: !!row.archived_at,
            createdAt: date(row.created_at, report.snapshotAt),
            updatedAt: date(row.updated_at, report.snapshotAt),
            github,
          };
          const imported = insert(
            kind,
            pid,
            row,
            "ticket",
            value,
            table,
            "tickets",
          );
          if (imported.created) {
            fresh.add(value.id);
            store.activity(
              value.id,
              "imported",
              "Imported from Kangentic; execution and delivery unverified",
              owner.ownerId,
            );
          }
          if (imported.value) tickets.set(`${kind}:${row.id}`, imported.value);
        }
      }
      for (const [table, kind, parentKind, parentField] of [
        ["task_attachments", "task-attachment", "task", "task_id"],
        [
          "backlog_attachments",
          "backlog-attachment",
          "backlog",
          "backlog_task_id",
        ],
      ]) {
        for (const attachment of bundle[table]) {
          const ticket = tickets.get(
            `${parentKind}:${attachment[parentField]}`,
          );
          const ref = metadata(attachment, table);
          // Preserve references only. Never follow source-provided attachment paths.
          if (ref.file_path && !isAbsolute(ref.file_path))
            ref.file_path = resolve(text(source.path) || root, ref.file_path);
          remember(kind, pid, attachment, "ticket", ticket?.id ?? null, table, {
            attachment: { ...ref, copyPending: true },
          });
          if (!ticket)
            warn(report, "ORPHAN_ATTACHMENT", {
              projectId: pid,
              sourceId: attachment.id,
            });
        }
      }
      const sessionsByTask = new Map();
      for (const session of bundle.sessions) {
        const group = sessionsByTask.get(session.task_id) ?? [];
        group.push(session);
        sessionsByTask.set(session.task_id, group);
      }
      for (const sourceTask of bundle.tasks) {
        const ticket = tickets.get(`task:${sourceTask.id}`);
        const sessions = sessionsByTask.get(sourceTask.id) ?? [];
        if (!ticket) continue;
        const held = sessions.filter(unresolved);
        const terminal = sessions.filter((s) => !unresolved(s));
        const selected =
          held.find(
            (s) =>
              s.id === sourceTask.session_id ||
              s.agent_session_id === sourceTask.session_id,
          ) ?? held.at(-1);
        const actor =
          [sourceTask.agent_override, sourceTask.agent].find(
            (a) => typeof a === "string" && store.get("agent", a),
          ) ?? "external-unknown";
        if (actor === "external-unknown" && held.length)
          warn(report, "UNVERIFIED_EXECUTOR", {
            projectId: pid,
            sourceId: sourceTask.id,
          });
        if (held.length > 1)
          warn(report, "MULTIPLE_UNRELEASED_SESSIONS", {
            projectId: pid,
            sourceId: sourceTask.id,
            count: held.length,
            message:
              "All handles preserved; one guarded claim holds the ticket.",
          });
        for (const session of [...terminal, ...(selected ? [selected] : [])]) {
          const executionId = mappingKey("session", pid, session.id);
          const prior = store.get("migration-record", executionId);
          if (!prior && fresh.has(ticket.id)) {
            const isHeld = unresolved(session);
            store.saveExecution({
              id: executionId,
              ticketId: ticket.id,
              agentId: actor,
              sessionId: text(session.agent_session_id) || session.id,
              state: isHeld
                ? session.status === "suspended"
                  ? "suspended"
                  : "external"
                : "exited",
              progress: null,
              lastSeq: 0,
              summary: isHeld
                ? "Imported external session; progress unverified; checkpoint before handoff"
                : "Imported exited session; delivery unverified",
              heartbeatAt: date(
                session.suspended_at,
                date(session.started_at, "1970-01-01T00:00:00.000Z"),
              ),
              startedAt: date(session.started_at, null),
              branch: text(sourceTask.branch_name) || null,
              worktreePath:
                text(sourceTask.worktree_path) || text(session.cwd) || null,
              prUrl: prUrl(sourceTask.pr_url),
              headSha: text(sourceTask.head_sha) || null,
              releasedAt: isHeld
                ? null
                : date(session.exited_at, report.snapshotAt),
              external: true,
              heldSessions: isHeld
                ? held
                    .filter((s) => s.id !== session.id)
                    .map((s) => ({
                      sourceSessionId: s.id,
                      sessionId: text(s.agent_session_id) || s.id,
                      state: s.status ?? "unknown",
                      releasedAt: null,
                    }))
                : [],
            });
            created.executions++;
          } else skipped.executions++;
          remember(
            "session",
            pid,
            session,
            "execution",
            store.execution(executionId) ? executionId : null,
            "sessions",
          );
        }
        for (const session of held.filter((s) => s.id !== selected?.id))
          remember(
            "session",
            pid,
            session,
            "execution",
            mappingKey("session", pid, selected.id),
            "sessions",
            { heldWithSourceSession: selected.id, releasedAt: null },
          );
        if (
          sourceTask.session_id &&
          !sessions.some(
            (s) =>
              s.id === sourceTask.session_id ||
              s.agent_session_id === sourceTask.session_id,
          )
        ) {
          warn(report, "MISSING_SOURCE_SESSION", {
            projectId: pid,
            sourceId: sourceTask.id,
          });
          if (fresh.has(ticket.id) && store.active(ticket.id)) {
            const execution = store.active(ticket.id);
            // An absent current handle still reserves the ticket alongside any
            // known source sessions; reconciling one must not release the other.
            store.saveExecution({
              ...execution,
              heldSessions: [
                ...(execution.heldSessions ?? []),
                {
                  sourceSessionId: sourceTask.session_id,
                  sessionId: sourceTask.session_id,
                  state: "unknown",
                  releasedAt: null,
                },
              ],
            });
          } else if (fresh.has(ticket.id)) {
            const executionId = mappingKey(
              "session-reference",
              pid,
              sourceTask.session_id,
            );
            store.saveExecution({
              id: executionId,
              ticketId: ticket.id,
              agentId: actor,
              sessionId: sourceTask.session_id,
              state: "external",
              progress: null,
              lastSeq: 0,
              summary:
                "Source session reference missing; reconcile before restarting",
              heartbeatAt: "1970-01-01T00:00:00.000Z",
              releasedAt: null,
              external: true,
              branch: sourceTask.branch_name ?? null,
              worktreePath: sourceTask.worktree_path ?? null,
            });
            created.executions++;
          }
        }
      }
      for (const session of bundle.sessions.filter(
        (s) => !tickets.has(`task:${s.task_id}`),
      )) {
        remember("session", pid, session, null, null, "sessions");
        warn(report, "ORPHAN_SESSION", {
          projectId: pid,
          sourceId: session.id,
        });
      }
    }
    report.created = created;
    report.skipped = skipped;
    report.mappings = mappings.sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
    const ticketMappings = mappings.filter(
      (m) =>
        m.targetKind === "ticket" && ["task", "backlog"].includes(m.sourceKind),
    );
    report.reconciliation = {
      sourceTickets: report.counts.tasks + report.counts.backlogItems,
      mappedTickets: ticketMappings.filter((m) =>
        store.get("ticket", m.targetId),
      ).length,
    };
    report.reconciliation.matches =
      report.reconciliation.sourceTickets ===
      report.reconciliation.mappedTickets;
    // This record is exposed in integrations: summary only. Full paths, source
    // routing and mappings remain in the private migration-record collection.
    store.put("migration", {
      id: "kangentic",
      sourceId: report.sourceId,
      importedAt: report.snapshotAt,
      counts: report.counts,
      created,
      skipped,
      reconciliation: report.reconciliation,
      warningCount: report.warnings.length,
    });
    store.put("migration-record", {
      id: `${report.sourceId}-snapshot-${hash(report.backup.manifest).slice(0, 16)}`,
      sourceId: report.sourceId,
      sourceRoot: root,
      backup: report.backup,
      importedAt: report.snapshotAt,
    });
  });
  service.changed();
  return report;
}
