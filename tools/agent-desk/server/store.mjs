import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const fail = (status, code, message) => {
  throw new AppError(status, code, message);
};
export const now = () => new Date().toISOString();
export const id = () => randomUUID();

export class Store {
  constructor(path) {
    this.path = path;
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,project_id TEXT,
        version INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE INDEX IF NOT EXISTS records_project ON records(kind,project_id);
      CREATE TABLE IF NOT EXISTS executions(id TEXT PRIMARY KEY,ticket_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,session_id TEXT NOT NULL,state TEXT NOT NULL,last_seq INTEGER NOT NULL DEFAULT 0,
        heartbeat_at TEXT NOT NULL,released_at TEXT,data TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS execution_active ON executions(ticket_id) WHERE released_at IS NULL;
      CREATE TABLE IF NOT EXISTS events(execution_id TEXT NOT NULL,event_id TEXT NOT NULL,seq INTEGER NOT NULL,
        data TEXT NOT NULL,PRIMARY KEY(execution_id,event_id),UNIQUE(execution_id,seq));
      CREATE TABLE IF NOT EXISTS activity(id TEXT PRIMARY KEY,ticket_id TEXT,at TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_jobs(ticket_id TEXT PRIMARY KEY,attempts INTEGER NOT NULL DEFAULT 0,
        retry_at TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',error TEXT);
      PRAGMA user_version=1;`);
  }
  transaction(fn) {
    if (this.inTransaction) return fn();
    this.db.exec("BEGIN IMMEDIATE");
    this.inTransaction = true;
    try {
      const v = fn();
      this.db.exec("COMMIT");
      return v;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    } finally {
      this.inTransaction = false;
    }
  }
  get(kind, key) {
    const row = this.db
      .prepare("SELECT data,version FROM records WHERE kind=? AND id=?")
      .get(kind, key);
    return row ? { ...JSON.parse(row.data), version: row.version } : null;
  }
  list(kind, projectId) {
    const rows = projectId
      ? this.db
          .prepare(
            "SELECT data,version FROM records WHERE kind=? AND project_id=?",
          )
          .all(kind, projectId)
      : this.db
          .prepare("SELECT data,version FROM records WHERE kind=?")
          .all(kind);
    return rows.map((r) => ({ ...JSON.parse(r.data), version: r.version }));
  }
  put(kind, value, expected) {
    const existing = this.get(kind, value.id);
    if (expected !== undefined && existing?.version !== expected)
      fail(409, "VERSION_CONFLICT", "This item changed. Reload before saving.");
    const next = { ...value, version: (existing?.version ?? 0) + 1 };
    this.db
      .prepare(
        "INSERT INTO records(kind,id,project_id,version,data) VALUES(?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET project_id=excluded.project_id,version=excluded.version,data=excluded.data",
      )
      .run(
        kind,
        next.id,
        next.projectId ?? null,
        next.version,
        JSON.stringify(next),
      );
    return next;
  }
  delete(kind, key) {
    this.db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, key);
  }
  activity(ticketId, kind, summary, agentId = null) {
    const value = { id: id(), ticketId, kind, summary, agentId, at: now() };
    this.db
      .prepare("INSERT INTO activity VALUES(?,?,?,?)")
      .run(value.id, ticketId, value.at, JSON.stringify(value));
    return value;
  }
  activities(limit = 300) {
    return this.db
      .prepare("SELECT data FROM activity ORDER BY at DESC,rowid DESC LIMIT ?")
      .all(limit)
      .map((r) => JSON.parse(r.data));
  }
  execution(key) {
    return this.decodeExecution(
      this.db.prepare("SELECT * FROM executions WHERE id=?").get(key),
    );
  }
  active(ticketId) {
    return this.decodeExecution(
      this.db
        .prepare(
          "SELECT * FROM executions WHERE ticket_id=? AND released_at IS NULL",
        )
        .get(ticketId),
    );
  }
  latest(ticketId) {
    return this.decodeExecution(
      this.db
        .prepare(
          "SELECT * FROM executions WHERE ticket_id=? ORDER BY rowid DESC LIMIT 1",
        )
        .get(ticketId),
    );
  }
  decodeExecution(row) {
    return row
      ? {
          ...JSON.parse(row.data),
          id: row.id,
          ticketId: row.ticket_id,
          agentId: row.agent_id,
          sessionId: row.session_id,
          state: row.state,
          lastSeq: row.last_seq,
          heartbeatAt: row.heartbeat_at,
          releasedAt: row.released_at,
          stale:
            !row.released_at &&
            (!Number.isFinite(Date.parse(row.heartbeat_at)) ||
              Date.now() - Date.parse(row.heartbeat_at) > 90000),
        }
      : null;
  }
  saveExecution(value) {
    this.db
      .prepare(
        `INSERT INTO executions(id,ticket_id,agent_id,session_id,state,last_seq,heartbeat_at,released_at,data) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,last_seq=excluded.last_seq,heartbeat_at=excluded.heartbeat_at,released_at=excluded.released_at,data=excluded.data`,
      )
      .run(
        value.id,
        value.ticketId,
        value.agentId,
        value.sessionId,
        value.state,
        value.lastSeq ?? 0,
        value.heartbeatAt ?? now(),
        value.releasedAt ?? null,
        JSON.stringify(value),
      );
    return this.execution(value.id);
  }
  enqueue(ticketId) {
    this.db
      .prepare(
        "INSERT INTO sync_jobs(ticket_id,retry_at) VALUES(?,?) ON CONFLICT(ticket_id) DO UPDATE SET state='pending',attempts=0,retry_at=excluded.retry_at,error=NULL",
      )
      .run(ticketId, now());
  }
  close() {
    this.db.close();
  }
}
