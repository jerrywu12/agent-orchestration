import { DatabaseSync } from "node:sqlite";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const lifecycleColumns = [
  "id",
  "task_id",
  "agent_session_id",
  "status",
  "exited_at",
];
const sourceStates = new Set([
  "running",
  "suspended",
  "exited",
  "starting",
  "pending",
  "stopped",
  "failed",
  "paused",
]);
const eligible = (execution) =>
  execution?.external === true &&
  !execution.releasedAt &&
  execution.lastSeq === 0;
const date = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;

function openSource(root, projectId) {
  if (
    typeof root !== "string" ||
    !isAbsolute(root) ||
    realpathSync(root) !== resolve(root) ||
    typeof projectId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(projectId)
  )
    throw new Error("unavailable");
  const projects = join(root, "projects");
  const path = join(projects, `${projectId}.db`);
  if (
    realpathSync(projects) !== projects ||
    !lstatSync(projects).isDirectory() ||
    realpathSync(path) !== path ||
    !lstatSync(path).isFile()
  )
    throw new Error("unavailable");
  for (const suffix of ["-wal", "-shm"])
    if (
      existsSync(path + suffix) &&
      (!lstatSync(path + suffix).isFile() ||
        lstatSync(path + suffix).isSymbolicLink())
    )
      throw new Error("unavailable");
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec(
      "PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=50; BEGIN",
    );
    const table = db
      .prepare("SELECT type,sql FROM sqlite_schema WHERE name='sessions'")
      .get();
    if (table?.type !== "table" || !/^CREATE\s+TABLE\b/i.test(table.sql ?? ""))
      throw new Error("unavailable");
    const fields = db.prepare("PRAGMA table_xinfo(sessions)").all();
    const selected = lifecycleColumns.filter((name) =>
      fields.some((field) => field.name === name && field.hidden === 0),
    );
    if (!["id", "task_id", "status"].every((name) => selected.includes(name)))
      throw new Error("unavailable");
    // Only ordinary allowlisted columns and bound, already imported identities.
    const projection = selected.map((name) => `"${name}"`).join(",");
    return {
      db,
      selected,
      byId: db.prepare(
        `SELECT ${projection} FROM sessions WHERE id=? AND task_id=? LIMIT 2`,
      ),
      byReference: db.prepare(
        `SELECT ${projection} FROM sessions WHERE task_id=? AND (id=?${selected.includes("agent_session_id") ? " OR agent_session_id=?" : ""}) LIMIT 2`,
      ),
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

function slots(execution) {
  return [
    ...(!execution.primaryReconciled
      ? [{ sessionId: execution.sessionId, primary: true }]
      : []),
    ...(execution.heldSessions ?? [])
      .filter((s) => !s.releasedAt)
      .map((s) => ({
        sessionId: s.sessionId,
        sourceSessionId: s.sourceSessionId,
        primary: false,
      })),
  ];
}

function observationsFor(store) {
  const records = store
    .list("migration-record")
    .filter((r) => r.sourceId?.startsWith("kangentic-") && r.mapping);
  const groups = new Map();
  function group(execution) {
    if (!eligible(execution)) return null;
    if (!groups.has(execution.id)) groups.set(execution.id, new Map());
    return groups.get(execution.id);
  }
  for (const record of records) {
    const map = record.mapping;
    if (
      map.sourceKind !== "session" ||
      map.targetKind !== "execution" ||
      !map.targetId
    )
      continue;
    const execution = store.execution(map.targetId);
    const target = group(execution);
    if (!target) continue;
    const slot = slots(execution).find(
      (s) =>
        s.sourceSessionId === map.originalId ||
        s.sessionId ===
          (record.sourceMetadata?.agent_session_id || map.originalId),
    );
    if (slot)
      target.set(slot.sessionId, {
        ...slot,
        root: record.sourceRoot,
        projectId: map.sourceProjectId,
        taskId: record.sourceMetadata?.task_id,
        sourceSessionId: map.originalId,
        lookup: "id",
      });
  }
  // An imported task may retain a current handle whose source session row was
  // already missing. That existing task mapping is the only fallback authority.
  for (const record of records) {
    const map = record.mapping;
    const reference = record.sourceMetadata?.session_id;
    if (
      map.sourceKind !== "task" ||
      map.targetKind !== "ticket" ||
      !map.targetId ||
      !reference
    )
      continue;
    const execution = store.active(map.targetId);
    const target = group(execution);
    if (!target) continue;
    const slot = slots(execution).find(
      (s) => s.sessionId === reference || s.sourceSessionId === reference,
    );
    if (slot && !target.has(slot.sessionId))
      target.set(slot.sessionId, {
        ...slot,
        root: record.sourceRoot,
        projectId: map.sourceProjectId,
        taskId: map.originalId,
        sourceSessionId: reference,
        lookup: "reference",
      });
  }
  return groups;
}

function observe(connection, descriptor, at) {
  const base = {
    sourceSessionId: descriptor.sourceSessionId,
    sessionId: descriptor.sessionId,
    sourceObservedAt: at,
    sourceExitedAt: null,
  };
  if (!connection || typeof descriptor.taskId !== "string")
    return { ...base, sourceState: "unavailable" };
  try {
    const rows =
      descriptor.lookup === "id"
        ? connection.byId.all(descriptor.sourceSessionId, descriptor.taskId)
        : connection.byReference.all(
            descriptor.taskId,
            descriptor.sourceSessionId,
            ...(connection.selected.includes("agent_session_id")
              ? [descriptor.sourceSessionId]
              : []),
          );
    if (!rows.length) return { ...base, sourceState: "missing" };
    if (rows.length !== 1) return { ...base, sourceState: "unavailable" };
    const row = rows[0];
    if (
      descriptor.lookup === "id" &&
      row.agent_session_id &&
      row.agent_session_id !== descriptor.sessionId
    )
      return { ...base, sourceState: "unavailable" };
    return {
      ...base,
      sourceState: sourceStates.has(row.status) ? row.status : "unknown",
      sourceExitedAt: date(row.exited_at),
    };
  } catch {
    return { ...base, sourceState: "unavailable" };
  }
}

function aggregate(sessions) {
  const states = new Set(sessions.map((s) => s.sourceState));
  for (const state of [
    "unavailable",
    "missing",
    "unknown",
    "running",
    "starting",
    "pending",
    "suspended",
    "paused",
  ])
    if (states.has(state)) return state;
  return states.size === 1 ? sessions[0].sourceState : "mixed";
}

/** Transitional, synchronous metadata observer. tick() never connects to a model
 * or starts work; auto polling defaults to 15 seconds and close() stops it. */
export class LegacyObserver {
  constructor(service, { auto = true, intervalMs = 15000 } = {}) {
    this.service = service;
    this.closed = false;
    this.lastError = null;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0)
      throw new Error("Invalid observer interval");
    if (auto) {
      this.timer = setInterval(() => {
        try {
          this.tick();
          this.lastError = null;
        } catch {
          this.lastError = "Legacy observer unavailable";
        }
      }, intervalMs);
      this.timer.unref?.();
    }
  }
  tick() {
    if (this.closed) return { observed: 0 };
    const store = this.service.store;
    const groups = observationsFor(store);
    const sources = new Map();
    const at = new Date().toISOString();
    let observed = 0;
    try {
      for (const [executionId, descriptors] of groups) {
        const sessions = [...descriptors.values()].map((descriptor) => {
          const key = JSON.stringify([descriptor.root, descriptor.projectId]);
          if (!sources.has(key)) {
            try {
              sources.set(
                key,
                openSource(descriptor.root, descriptor.projectId),
              );
            } catch {
              sources.set(key, null);
            }
          }
          return observe(sources.get(key), descriptor, at);
        });
        if (!sessions.length) continue;
        store.transaction(() => {
          const execution = store.execution(executionId);
          if (!eligible(execution)) return;
          const pending = new Set(slots(execution).map((s) => s.sessionId));
          const current = sessions.filter((s) => pending.has(s.sessionId));
          if (!current.length) return;
          const sourceState = aggregate(current);
          const sourceExitedAt =
            sourceState === "exited" && current.every((s) => s.sourceExitedAt)
              ? current
                  .map((s) => s.sourceExitedAt)
                  .sort()
                  .at(-1)
              : null;
          const counts = [...new Set(current.map((s) => s.sourceState))]
            .sort()
            .map(
              (state) =>
                `${current.filter((s) => s.sourceState === state).length} ${state}`,
            )
            .join(", ");
          store.saveExecution({
            ...execution,
            sourceState,
            sourceObservedAt: at,
            sourceExitedAt,
            sourceSessions: current,
            summary: `Legacy source: ${counts}; claim retained; progress and delivery unverified.`,
            heldSessions: (execution.heldSessions ?? []).map((session) => {
              const observation = current.find(
                (s) => s.sessionId === session.sessionId,
              );
              return observation && !session.releasedAt
                ? {
                    ...session,
                    sourceState: observation.sourceState,
                    sourceObservedAt: at,
                    sourceExitedAt: observation.sourceExitedAt,
                  }
                : session;
            }),
          });
          observed++;
        });
      }
    } finally {
      for (const source of sources.values()) source?.db.close();
    }
    if (observed) this.service.changed();
    return { observed };
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
  }
}
