#!/usr/bin/env node
import { DatabaseSync, backup } from "node:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
const [command, sourceArg, targetArg] = process.argv.slice(2);
if (!["create", "restore"].includes(command) || !sourceArg || !targetArg) {
  console.error(
    "Usage: node bin/backup.mjs create|restore SOURCE_DB NEW_DESTINATION_DB",
  );
  process.exit(1);
}
const source = resolve(sourceArg),
  target = resolve(targetArg);
if (!existsSync(source) || existsSync(target))
  throw Error(
    "Source must exist and destination must be new. Existing data is never overwritten.",
  );
mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(source, { readOnly: true });
try {
  if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
    throw Error("Source integrity check failed.");
  await backup(db, target);
  chmodSync(target, 0o600);
  console.log(`${command}: ${target}`);
} finally {
  db.close();
}
