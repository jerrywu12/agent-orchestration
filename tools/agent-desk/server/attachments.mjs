import { createHash } from "node:crypto";
import { fail, id } from "./store.mjs";
const DAY = 24 * 60 * 60 * 1000;
export class Attachments {
  constructor(
    store,
    { clock = Date.now, maxDrafts = 20, maxBytes = 1024 ** 3 } = {},
  ) {
    this.store = store;
    this.clock = clock;
    this.maxDrafts = Math.min(20, maxDrafts);
    this.maxBytes = Math.min(1024 ** 3, maxBytes);
    store.db.exec(`CREATE TABLE IF NOT EXISTS attachments(
      id TEXT PRIMARY KEY, ticket_id TEXT, name TEXT NOT NULL, media_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL, sha256 TEXT NOT NULL, extracted_text TEXT NOT NULL,
      warnings TEXT NOT NULL, page_count INTEGER, original BLOB NOT NULL,
      created_at TEXT NOT NULL, expires_at INTEGER);
      CREATE INDEX IF NOT EXISTS attachments_ticket ON attachments(ticket_id);`);
  }
  prune() {
    this.store.db
      .prepare(
        "DELETE FROM attachments WHERE ticket_id IS NULL AND expires_at <= ?",
      )
      .run(this.clock());
  }
  decode(row, text = true) {
    return {
      id: row.id,
      ticketId: row.ticket_id,
      name: row.name,
      mediaType: row.media_type,
      size: row.byte_size,
      sha256: row.sha256,
      createdAt: row.created_at,
      warnings: JSON.parse(row.warnings),
      ...(row.page_count == null ? {} : { pageCount: row.page_count }),
      ...(text ? { text: row.extracted_text } : {}),
    };
  }
  save({ name, bytes, result }) {
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 255 ||
      /[\x00-\x1f\x7f/\\]/.test(name)
    )
      fail(
        422,
        "ATTACHMENT_NAME",
        "Use a short file name without paths or control characters.",
      );
    if (
      !Buffer.isBuffer(bytes) ||
      !bytes.length ||
      bytes.length > 10 * 1024 ** 2
    )
      fail(
        413,
        "ATTACHMENT_SIZE",
        "Each document must be between 1 byte and 10 MiB.",
      );
    if (
      !result ||
      typeof result.text !== "string" ||
      !result.text.trim() ||
      result.text.length > 100000
    )
      fail(
        422,
        "ATTACHMENT_TEXT",
        "The document must contain at most 100,000 characters of readable text.",
      );
    return this.store.transaction(() => {
      this.prune();
      const usage = this.store.db
        .prepare(
          "SELECT COALESCE(SUM(byte_size + length(CAST(extracted_text AS BLOB)) + length(CAST(warnings AS BLOB)) + length(CAST(name AS BLOB)) + 256),0) AS bytes, SUM(CASE WHEN ticket_id IS NULL THEN 1 ELSE 0 END) AS drafts FROM attachments",
        )
        .get();
      if (usage.drafts >= this.maxDrafts)
        fail(
          409,
          "DRAFT_LIMIT",
          "Too many draft documents. Remove unused drafts or try after they expire.",
        );
      const storedBytes =
        bytes.length +
        Buffer.byteLength(result.text) +
        Buffer.byteLength(JSON.stringify(result.warnings ?? [])) +
        Buffer.byteLength(name) +
        256;
      if (usage.bytes + storedBytes > this.maxBytes)
        fail(413, "STORAGE_LIMIT", "Attachment storage limit reached.");
      const key = id(),
        at = this.clock();
      this.store.db
        .prepare("INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(
          key,
          null,
          name.trim(),
          result.mediaType,
          bytes.length,
          createHash("sha256").update(bytes).digest("hex"),
          result.text,
          JSON.stringify(result.warnings ?? []),
          result.pageCount ?? null,
          bytes,
          new Date(at).toISOString(),
          at + DAY,
        );
      return this.get(key);
    });
  }
  row(key, original = false) {
    // Reading expired drafts never exposes their contents, even before periodic cleanup.
    const row = this.store.db
      .prepare(
        `SELECT ${original ? "*" : "id,ticket_id,name,media_type,byte_size,sha256,extracted_text,warnings,page_count,created_at,expires_at"} FROM attachments WHERE id=? AND (ticket_id IS NOT NULL OR expires_at > ?)`,
      )
      .get(key, this.clock());
    return (
      row ??
      fail(
        404,
        "ATTACHMENT_NOT_FOUND",
        "Attachment not found or draft expired.",
      )
    );
  }
  get(key) {
    return this.decode(this.row(key));
  }
  original(key) {
    const row = this.row(key, true);
    return { ...this.decode(row, false), bytes: Buffer.from(row.original) };
  }
  list(ticketId, text = false) {
    const rows = this.store.db
      .prepare(
        `SELECT id,ticket_id,name,media_type,byte_size,sha256,${text ? "extracted_text," : ""}warnings,page_count,created_at FROM attachments WHERE ticket_id=? ORDER BY created_at,id`,
      )
      .all(ticketId);
    return rows.map((row) => this.decode(row, text));
  }
  bind(keys, ticketId) {
    if (
      !Array.isArray(keys) ||
      keys.length > 5 ||
      keys.some((key) => typeof key !== "string")
    )
      fail(422, "ATTACHMENT_IDS", "Choose at most five document attachments.");
    if (new Set(keys).size !== keys.length)
      fail(422, "ATTACHMENT_IDS", "Duplicate attachment IDs are not allowed.");
    for (const key of keys)
      if (this.row(key).ticket_id)
        fail(
          409,
          "ATTACHMENT_BOUND",
          "An attachment is already bound to a ticket.",
        );
    for (const key of keys)
      this.store.db
        .prepare(
          "UPDATE attachments SET ticket_id=?, expires_at=NULL WHERE id=?",
        )
        .run(ticketId, key);
  }
  removeDraft(key) {
    if (this.row(key).ticket_id)
      fail(409, "ATTACHMENT_BOUND", "This attachment is bound to a ticket.");
    this.store.db
      .prepare("DELETE FROM attachments WHERE id=? AND ticket_id IS NULL")
      .run(key);
    return { ok: true };
  }
}
