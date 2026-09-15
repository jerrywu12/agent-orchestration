import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Store } from "../server/store.mjs";
import { Service } from "../server/service.mjs";
import {
  processDocument,
  DOCUMENT_LIMITS,
} from "../server/document-processor.mjs";
import { createAppServer } from "../server/http.mjs";
const hash = (text) => createHash("sha256").update(text).digest("hex");
const data = (text = "# Specification\n", name = "spec.md") => ({
  name,
  bytes: Buffer.from(text),
  result: { text, mediaType: "text/markdown", warnings: [] },
});
function fixture(t, path = ":memory:") {
  const store = new Store(path);
  t.after(() => store.close());
  const service = new Service(store);
  const project = service.createProject({ name: "Synthetic docs" });
  const ticket = service.createTicket({
    projectId: project.id,
    title: "Existing ticket",
    ownerId: null,
    effort: "M",
    labels: ["keep"],
    brief: { scope: "unchanged" },
  });
  return { store, service, ticket };
}
const code = (expected) => (error) => error.code === expected;
test("Markdown preserves whitespace/full text and stays bounded", async () => {
  const source =
    "  # Heading\r\n\r\n    indented code\n\n" + "x".repeat(148160) + "\n";
  for (const name of ["spec.md", "SPEC.MARKDOWN"]) {
    const result = await processDocument({
      name,
      bytes: Buffer.from(source),
    });
    assert.equal(result.mediaType, "text/markdown");
    assert.equal(result.text, source);
    assert.equal(result.sha256, hash(source));
  }
  // Markdown and plain text share one ceiling that matches the 15 MiB byte cap.
  for (const name of ["large.md", "large.txt"])
    await assert.rejects(
      () =>
        processDocument({
          name,
          bytes: Buffer.alloc(DOCUMENT_LIMITS.maxFileBytes + 1, 0x78),
        }),
      code("document_limit"),
    );
  await assert.rejects(
    () =>
      processDocument(
        { name: "small.md", bytes: Buffer.from("x".repeat(101)) },
        { limits: { maxMarkdownChars: 100 } },
      ),
    code("document_limit"),
  );
  await assert.rejects(
    () =>
      processDocument(
        { name: "small.txt", bytes: Buffer.from("x".repeat(101)) },
        { limits: { maxTextChars: 100 } },
      ),
    code("document_limit"),
  );
  for (const bytes of [
    Buffer.from([0xff, 0x00, 0xab]),
    Buffer.from("%PDF-fake"),
    Buffer.from("bad\0text"),
  ])
    await assert.rejects(
      () => processDocument({ name: "bad.md", bytes }),
      code("invalid_document"),
    );
});
test("existing ticket append is atomic, bounded, version checked and idempotent", (t) => {
  const { service, store, ticket } = fixture(t);
  const a = service.attachments.save(data());
  const second = service.attachments.save(data("# Second"));
  assert.throws(
    () =>
      service.attachDocuments(ticket.id, {
        version: ticket.version,
        attachmentIds: [a.id, "missing"],
      }),
    code("ATTACHMENT_NOT_FOUND"),
  );
  assert.equal(service.attachments.get(a.id).ticketId, null);
  assert.equal(service.getTicket(ticket.id).version, ticket.version);
  const bound = service.attachDocuments(ticket.id, {
    version: ticket.version,
    attachmentIds: [a.id],
  });
  for (const field of [
    "ownerId",
    "stageId",
    "priority",
    "effort",
    "labels",
    "brief",
    "dependsOn",
    "stageHistory",
  ])
    assert.deepEqual(bound[field], ticket[field]);
  assert.equal(bound.version, ticket.version + 1);
  assert.equal(bound.attachmentContext[0].text, data().result.text);
  const events = store.activities().length;
  assert.equal(
    service.attachDocuments(ticket.id, {
      version: ticket.version,
      attachmentIds: [a.id],
    }).version,
    bound.version,
  );
  assert.equal(store.activities().length, events);
  assert.throws(
    () =>
      service.attachDocuments(ticket.id, {
        version: ticket.version,
        attachmentIds: [second.id],
      }),
    code("VERSION_CONFLICT"),
  );
  assert.throws(
    () =>
      service.attachDocuments(ticket.id, {
        version: bound.version,
        attachmentIds: [a.id, second.id],
      }),
    code("ATTACHMENT_BOUND"),
  );
  const duplicate = service.attachments.save(data());
  assert.throws(
    () =>
      service.attachDocuments(ticket.id, {
        version: bound.version,
        attachmentIds: [duplicate.id],
      }),
    code("ATTACHMENT_DUPLICATE"),
  );
  const other = service.createTicket({
    projectId: ticket.projectId,
    title: "Other",
  });
  assert.throws(
    () =>
      service.attachDocuments(other.id, {
        version: other.version,
        attachmentIds: [a.id],
      }),
    code("ATTACHMENT_BOUND"),
  );
  const rest = Array.from({ length: 4 }, (_, i) =>
    service.attachments.save(data(`# ${i}`)),
  );
  const full = service.attachDocuments(ticket.id, {
    version: bound.version,
    attachmentIds: rest.map((a) => a.id),
  });
  assert.throws(
    () =>
      service.attachDocuments(ticket.id, {
        version: full.version,
        attachmentIds: [second.id],
      }),
    code("ATTACHMENT_IDS"),
  );
  assert.equal(service.getTicket(ticket.id).attachments.length, 5);
  assert.equal(service.attachments.get(second.id).ticketId, null);
});
test("Markdown save atomically updates copy, context, hash and ticket version; stale writers lose", (t) => {
  const { service, ticket, store } = fixture(t);
  const original = data();
  const a = service.attachments.save(original);
  const bound = service.attachDocuments(ticket.id, {
    version: ticket.version,
    attachmentIds: [a.id],
  });
  const text = "  # Edited\n\n" + "z".repeat(150000) + "\n";
  const saved = service.updateMarkdown(a.id, {
    expectedSha256: a.sha256,
    text,
  });
  assert.equal(saved.text, text);
  assert.equal(saved.sha256, hash(text));
  assert.equal(saved.size, Buffer.byteLength(text));
  assert.deepEqual(original.bytes, data().bytes);
  assert.equal(service.attachments.original(a.id).bytes.toString(), text);
  assert.equal(service.getTicket(ticket.id).attachmentContext[0].text, text);
  assert.equal(service.getTicket(ticket.id).version, bound.version + 1);
  assert.throws(
    () =>
      service.updateMarkdown(a.id, {
        expectedSha256: a.sha256,
        text: "stale",
      }),
    code("ATTACHMENT_CONFLICT"),
  );
  assert.throws(
    () =>
      service.updateTicket(ticket.id, {
        version: bound.version,
        title: "stale title",
      }),
    code("VERSION_CONFLICT"),
  );
  for (const text of [
    "",
    "x".repeat(DOCUMENT_LIMITS.maxMarkdownChars + 1),
    "bad\0text",
    "\ud800",
  ])
    assert.throws(() =>
      service.updateMarkdown(a.id, { expectedSha256: saved.sha256, text }),
    );
  assert.equal(service.attachments.get(a.id).sha256, saved.sha256);
  const draft = service.attachments.save(data("# Draft"));
  assert.throws(
    () =>
      service.updateMarkdown(draft.id, {
        expectedSha256: draft.sha256,
        text: "draft mutation",
      }),
    code("ATTACHMENT_READ_ONLY"),
  );
  const txt = service.attachments.save({
    ...data("text", "plain.txt"),
    result: { text: "text", mediaType: "text/plain", warnings: [] },
  });
  const current = service.getTicket(ticket.id);
  service.attachDocuments(ticket.id, {
    version: current.version,
    attachmentIds: [txt.id],
  });
  assert.throws(
    () =>
      service.updateMarkdown(txt.id, {
        expectedSha256: txt.sha256,
        text: "new",
      }),
    code("ATTACHMENT_READ_ONLY"),
  );
  const version = service.getTicket(ticket.id).version;
  service.attachments.maxBytes = 1024;
  assert.throws(
    () =>
      service.updateMarkdown(a.id, {
        expectedSha256: saved.sha256,
        text: "y".repeat(199999),
      }),
    code("STORAGE_LIMIT"),
  );
  assert.equal(service.getTicket(ticket.id).version, version);
  assert.equal(service.attachments.get(a.id).sha256, saved.sha256);
  const activities = store.db.prepare("SELECT data FROM activity").all();
  assert.ok(activities.every((r) => !r.data.includes("z".repeat(100))));
});
test("edited Markdown survives SQLite reopen", (t) => {
  const root = mkdtempSync(join(tmpdir(), "markdown-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "desk.db");
  let store = new Store(path),
    service = new Service(store);
  const project = service.createProject({ name: "Reopen" }),
    a = service.attachments.save(data());
  const ticket = service.createTicket({
    projectId: project.id,
    title: "Reopen",
    attachmentIds: [a.id],
  });
  service.updateMarkdown(a.id, {
    expectedSha256: a.sha256,
    text: "# Persisted\n",
  });
  store.close();
  store = new Store(path);
  service = new Service(store);
  assert.equal(
    service.getTicket(ticket.id).attachmentContext[0].text,
    "# Persisted\n",
  );
  assert.equal(
    service.attachments.original(a.id).sha256,
    hash("# Persisted\n"),
  );
  store.close();
});
test("new attachment mutations are admin-only, scoped reads retain full Markdown", async (t) => {
  const { service, ticket } = fixture(t);
  const server = createAppServer({
    service,
    adminToken: "synthetic-admin",
    agentTokens: { codex: "synthetic-agent" },
    runner: { availability: () => [] },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, token = "synthetic-admin") =>
    fetch(url + "/api" + path, {
      method,
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const response = await call("POST", "/attachments", {
    name: "spec.md",
    contentBase64: Buffer.from("# API document").toString("base64"),
  });
  assert.equal(response.status, 201);
  const attachment = await response.json();
  let r = await call("POST", `/tickets/${ticket.id}/attachments`, {
    version: ticket.version,
    attachmentIds: [attachment.id],
  });
  assert.equal(r.status, 200);
  r = await call("PATCH", `/attachments/${attachment.id}`, {
    expectedSha256: attachment.sha256,
    text: "# API saved",
  });
  assert.equal(r.status, 200);
  const saved = await r.json();
  for (const [method, path, body] of [
    [
      "POST",
      `/tickets/${ticket.id}/attachments`,
      { version: 2, attachmentIds: [attachment.id] },
    ],
    [
      "PATCH",
      `/attachments/${attachment.id}`,
      { expectedSha256: saved.sha256, text: "agent edit" },
    ],
  ])
    assert.equal(
      (await call(method, path, body, "synthetic-agent")).status,
      403,
    );
  service.updateTicket(ticket.id, {
    version: service.getTicket(ticket.id).version,
    ownerId: "codex",
  });
  r = await call("GET", `/tickets/${ticket.id}`, undefined, "synthetic-agent");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).attachmentContext[0].text, "# API saved");
  r = await call(
    "GET",
    `/attachments/${attachment.id}/download`,
    undefined,
    "synthetic-agent",
  );
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition"), /attachment/);
  assert.equal(await r.text(), "# API saved");
});

test("document append audit captures the attachment identity and hash", (t) => {
  const { service, store, ticket } = fixture(t);
  let time = 0;
  service.attachments.clock = () => time;
  service.attachments.maxBytes = 2000;
  const a = service.attachments.save(data("# A"));
  service.attachDocuments(ticket.id, {
    version: ticket.version,
    attachmentIds: [a.id],
  });
  const event = store
    .activities()
    .find((item) => item.kind === "documents-attached");
  assert.equal(event.summary, `Attached documents: ${a.id} (${a.sha256})`);
});

test("expired drafts do not block valid Markdown edits", (t) => {
  const { service, ticket } = fixture(t);
  let time = 0;
  service.attachments.clock = () => time;
  service.attachments.maxBytes = 2000;
  const a = service.attachments.save(data("# A"));
  service.attachDocuments(ticket.id, {
    version: ticket.version,
    attachmentIds: [a.id],
  });
  const expired = service.attachments.save(data("x".repeat(600)));
  time = 24 * 60 * 60 * 1000 + 1;
  const saved = service.updateMarkdown(a.id, {
    expectedSha256: a.sha256,
    text: "y".repeat(500),
  });
  assert.equal(saved.text.length, 500);
  assert.throws(
    () => service.attachments.get(expired.id),
    code("ATTACHMENT_NOT_FOUND"),
  );
});
