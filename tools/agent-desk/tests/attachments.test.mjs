import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";
import { Service } from "../server/service.mjs";
import { Attachments } from "../server/attachments.mjs";
const document = (name = "brief.txt") => ({
  name,
  bytes: Buffer.from("Acceptance: all tests pass."),
  result: {
    text: "Acceptance: all tests pass.",
    mediaType: "text/plain",
    warnings: [],
  },
});
test("draft binds atomically, is immutable and survives SQLite reopen", (t) => {
  const root = mkdtempSync(join(tmpdir(), "desk-attachment-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let store = new Store(join(root, "desk.db"));
  let service = new Service(store);
  const p = service.createProject({ name: "Docs" });
  const a = service.attachments.save(document());
  assert.equal(a.ticketId, null);
  assert.equal(a.text, document().result.text);
  assert.throws(
    () =>
      service.createTicket({
        projectId: p.id,
        title: "Fails",
        attachmentIds: [a.id, "missing"],
      }),
    /attachment/i,
  );
  assert.equal(store.list("ticket").length, 0);
  assert.equal(service.attachments.get(a.id).ticketId, null);
  const ticket = service.createTicket({
    projectId: p.id,
    title: "Intake",
    attachmentIds: [a.id],
    brief: {
      acceptanceCriteria: "Visible result",
      scope: "src/**",
      verification: "npm test",
    },
  });
  assert.equal(ticket.attachments[0].text, undefined);
  assert.equal(
    service.getTicket(ticket.id).attachmentContext[0].text,
    document().result.text,
  );
  assert.throws(() => service.attachments.removeDraft(a.id), /bound/i);
  assert.throws(
    () =>
      service.createTicket({
        projectId: p.id,
        title: "Reuse",
        attachmentIds: [a.id],
      }),
    /attachment/i,
  );
  store.close();
  store = new Store(join(root, "desk.db"));
  service = new Service(store);
  assert.deepEqual(service.attachments.original(a.id).bytes, document().bytes);
  assert.equal(service.getTicket(ticket.id).brief.verification, "npm test");
  store.close();
});
test("draft expiry, quotas, duplicate ids and brief limits are enforced", () => {
  const store = new Store(":memory:");
  let time = 0;
  const a = new Attachments(store, {
    clock: () => time,
    maxDrafts: 2,
    maxBytes: 10000,
  });
  const first = a.save(document());
  a.save(document("two.txt"));
  assert.throws(() => a.save(document("three.txt")), /draft/i);
  time = 24 * 60 * 60 * 1000 + 1;
  assert.throws(() => a.get(first.id), /attachment/i);
  a.save(document("new.txt"));
  const s = new Service(store),
    p = s.createProject({ name: "Bounds" }),
    b = s.attachments.save(document("b.txt"));
  assert.throws(
    () =>
      s.createTicket({
        projectId: p.id,
        title: "Bad",
        attachmentIds: [b.id, b.id],
      }),
    /duplicate/i,
  );
  assert.throws(
    () =>
      s.createTicket({
        projectId: p.id,
        title: "Bad",
        brief: { scope: "x".repeat(10001) },
      }),
    /brief|scope/i,
  );
  store.close();
});
test("storage quota includes expanded text, not only compressed original bytes", () => {
  const store = new Store(":memory:"),
    attachments = new Attachments(store, { maxBytes: 100 });
  assert.throws(
    () =>
      attachments.save({
        name: "compressed.pdf",
        bytes: Buffer.from("x"),
        result: {
          text: "A".repeat(100000),
          mediaType: "application/pdf",
          warnings: [],
        },
      }),
    /storage/i,
  );
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM attachments").get().n,
    0,
  );
  store.close();
});
test("duplicate create IDs cannot replace tickets or add a sixth attachment", () => {
  const store = new Store(":memory:"),
    service = new Service(store),
    project = service.createProject({ id: "project", name: "Original" });
  const first = Array.from({ length: 5 }, (_, i) =>
    service.attachments.save(document(`first-${i}.txt`)),
  );
  service.createTicket({
    id: "ticket",
    projectId: project.id,
    title: "Original ticket",
    attachmentIds: first.map((a) => a.id),
  });
  const extra = service.attachments.save(document("extra.txt"));
  assert.throws(
    () =>
      service.createTicket({
        id: "ticket",
        projectId: project.id,
        title: "Replacement",
        attachmentIds: [extra.id],
      }),
    /already exists/i,
  );
  assert.equal(service.getTicket("ticket").title, "Original ticket");
  assert.equal(service.getTicket("ticket").attachments.length, 5);
  assert.equal(service.attachments.get(extra.id).ticketId, null);
  assert.throws(
    () => service.createProject({ id: "project", name: "Replacement" }),
    /already exists/i,
  );
  store.close();
});
