import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const THREADS_TABLE_SCHEMA = `
CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  rollout_path TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now')),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch('now')),
  source TEXT NOT NULL,
  model_provider TEXT NOT NULL DEFAULT 'openai',
  cwd TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  sandbox_policy TEXT NOT NULL DEFAULT '',
  approval_mode TEXT NOT NULL DEFAULT '',
  tokens_used INTEGER NOT NULL DEFAULT 0,
  has_user_event INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  archived_at INTEGER,
  git_sha TEXT,
  git_branch TEXT,
  git_origin_url TEXT,
  cli_version TEXT NOT NULL DEFAULT '',
  first_user_message TEXT NOT NULL DEFAULT '',
  agent_nickname TEXT,
  agent_role TEXT,
  memory_mode TEXT NOT NULL DEFAULT 'enabled',
  model TEXT,
  reasoning_effort TEXT,
  agent_path TEXT,
  created_at_ms INTEGER,
  updated_at_ms INTEGER,
  thread_source TEXT,
  preview TEXT NOT NULL DEFAULT '',
  recency_at INTEGER NOT NULL DEFAULT 0,
  recency_at_ms INTEGER NOT NULL DEFAULT 0,
  history_mode TEXT NOT NULL DEFAULT 'legacy',
  name TEXT,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  thread_section_id TEXT,
  section_position INTEGER,
  section_entered_at_ms INTEGER,
  project_id TEXT,
  originator TEXT,
  daybreak_enabled BOOLEAN
);
`;

export function createTestCodexDb({
  dir,
  filename = "state_5.sqlite",
  threads = [],
  createSchema = true,
  customSchema = null,
} = {}) {
  const dbPath = join(dir, filename);
  const db = new DatabaseSync(dbPath);
  if (customSchema) {
    db.exec(customSchema);
  } else if (createSchema) {
    db.exec(THREADS_TABLE_SCHEMA);
  }
  if (threads.length > 0) {
    const insert = db.prepare(`
      INSERT INTO threads (
        id, rollout_path, created_at, updated_at, source, cwd, title, archived
      ) VALUES (
        @id, @rollout_path, @created_at, @updated_at, @source, @cwd, @title, @archived
      )
    `);
    const now = Math.floor(Date.now() / 1000);
    for (const t of threads) {
      insert.run({
        id: t.id,
        rollout_path: t.rollout_path ?? "",
        created_at: t.created_at ?? now,
        updated_at: t.updated_at ?? now,
        source: t.source ?? "cli",
        cwd: t.cwd ?? "/Users/example/project",
        title: t.title ?? "Test task",
        archived: t.archived ?? 0,
      });
    }
  }
  db.close();
  return dbPath;
}

export function createRollout({
  dir,
  filename,
  markers = [], // e.g. ['task_started', 'task_complete']
  prefixBytes = 0,
  betweenBytes = 0,
  suffixBytes = 0,
} = {}) {
  const filePath = join(dir, filename);
  const parts = [];
  if (prefixBytes > 0) {
    parts.push(Buffer.alloc(prefixBytes, 0x20));
  }
  for (let i = 0; i < markers.length; i++) {
    if (i > 0 && betweenBytes > 0) {
      parts.push(Buffer.alloc(betweenBytes, 0x20));
    }
    const marker = markers[i];
    parts.push(Buffer.from(`{"type":"${marker}"}\n`, "utf8"));
  }
  if (suffixBytes > 0) {
    parts.push(Buffer.alloc(suffixBytes, 0x20));
  }
  const content = parts.length > 0 ? Buffer.concat(parts) : Buffer.from("");
  writeFileSync(filePath, content);
  return filePath;
}

export function makeSyntheticPsOutput(rows = []) {
  // Format matching: /bin/ps -axo pid=,ppid=,etime=,command=
  // e.g.: " 1234  1000       01:23 /opt/homebrew/bin/claude"
  const lines = rows.map((r) => {
    const pid = String(r.pid).padStart(5, " ");
    const ppid = String(r.ppid ?? 1).padStart(5, " ");
    const etime = String(r.etime ?? "00:01").padStart(11, " ");
    return `${pid} ${ppid} ${etime} ${r.command}`;
  });
  return lines.join("\n") + "\n";
}

// Self-test when invoked directly
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const testDir = mkdtempSync(join(tmpdir(), "agent-activity-fixture-"));
  try {
    const rollout = createRollout({
      dir: testDir,
      filename: "test.rollout",
      markers: ["task_started"],
      prefixBytes: 100,
    });
    const dbPath = createTestCodexDb({
      dir: testDir,
      filename: "state_5.sqlite",
      threads: [
        {
          id: "019f4b72-test-thread",
          rollout_path: rollout,
          title: "Test task",
          source: "cli",
        },
      ],
    });
    const ps = makeSyntheticPsOutput([
      { pid: 1234, ppid: 1, etime: "05:20", command: "/usr/local/bin/claude" },
    ]);
    if (!dbPath || !rollout || !ps.includes("1234")) {
      throw new Error("Fixture builder validation failed");
    }
    console.log("Activity fixture builder self-test passed.");
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
}
