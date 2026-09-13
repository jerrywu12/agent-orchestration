#!/usr/bin/env node
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export const requestLimit = 64 * 1024;
export const responseLimit = 2 * 1024 * 1024;
export function bridgeError(code, message) {
  return Object.assign(Error(message), { code });
}
export function directoryIdentity(directory) {
  if (!directory || !isAbsolute(directory))
    throw bridgeError(
      "BRIDGE_FILE",
      "An absolute managed mailbox directory is required.",
    );
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077)
    throw bridgeError(
      "BRIDGE_FILE",
      "The managed mailbox must be a private real directory.",
    );
  return { dev: stat.dev, ino: stat.ino };
}
export function checkDirectory(directory, identity) {
  const current = directoryIdentity(directory);
  if (current.dev !== identity.dev || current.ino !== identity.ino)
    throw bridgeError("BRIDGE_FILE", "The managed mailbox directory changed.");
}
export function readBounded(path, limit) {
  let fd;
  try {
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit)
      throw bridgeError(
        "BRIDGE_FILE",
        "Mailbox messages must be bounded regular files.",
      );
    const bytes = Buffer.alloc(limit + 1);
    let size = 0,
      read;
    while ((read = readSync(fd, bytes, size, bytes.length - size, null)) > 0) {
      size += read;
      if (size > limit)
        throw bridgeError(
          "BRIDGE_FILE",
          "Mailbox message exceeds its size limit.",
        );
    }
    return bytes.subarray(0, size).toString("utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw error;
    if (error.code === "BRIDGE_FILE") throw error;
    throw bridgeError(
      "BRIDGE_FILE",
      "Unable to safely read the mailbox message.",
    );
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
export function writeAtomic(directory, identity, name, value, limit) {
  checkDirectory(directory, identity);
  const bytes = JSON.stringify(value);
  if (Buffer.byteLength(bytes) > limit)
    throw bridgeError("BRIDGE_FILE", "Mailbox message exceeds its size limit.");
  const temporary = join(directory, `${randomUUID()}.tmp`);
  let fd;
  try {
    fd = openSync(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(fd, bytes);
    closeSync(fd);
    fd = undefined;
    checkDirectory(directory, identity);
    renameSync(temporary, join(directory, name));
  } finally {
    if (fd !== undefined) closeSync(fd);
    try {
      checkDirectory(directory, identity);
      unlinkSync(temporary);
    } catch {}
  }
}

export async function managedRequest(
  directory,
  operation,
  input = {},
  { timeoutMs = 30000 } = {},
) {
  const identity = directoryIdentity(directory);
  const id = randomUUID();
  const response = join(directory, `${id}.response.json`);
  const closed = () => {
    checkDirectory(directory, identity);
    try {
      lstatSync(join(directory, ".closed"));
      throw bridgeError(
        "BRIDGE_CLOSED",
        "The managed execution reporting bridge is closed.",
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  };
  closed();
  writeAtomic(
    directory,
    identity,
    `${id}.request.json`,
    { id, operation, input },
    requestLimit,
  );
  const deadline = Date.now() + Math.min(120000, Math.max(1, timeoutMs));
  while (Date.now() < deadline) {
    checkDirectory(directory, identity);
    try {
      const message = JSON.parse(readBounded(response, responseLimit));
      checkDirectory(directory, identity);
      unlinkSync(response);
      if (message.id !== id)
        throw bridgeError(
          "BRIDGE_RESPONSE",
          "Mailbox response identity does not match.",
        );
      if (!message.ok)
        throw bridgeError(
          message.error?.code ?? "BRIDGE_ERROR",
          message.error?.message ?? "Managed reporting failed.",
        );
      return message.result;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    closed();
    await delay(25);
  }
  throw bridgeError(
    "BRIDGE_TIMEOUT",
    "Managed reporting did not respond before the deadline. The operation may already have been applied; verify current task state before retrying.",
  );
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    const [, , operation, input] = process.argv;
    const result = await managedRequest(
      process.env.AGENT_DESK_BRIDGE_DIR,
      operation,
      input ? JSON.parse(input) : {},
    );
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (error) {
    process.stderr.write(
      JSON.stringify({
        error: {
          code: error.code ?? "BRIDGE_ERROR",
          message: error.code
            ? error.message
            : "Invalid managed reporting request.",
        },
      }) + "\n",
    );
    process.exitCode = 1;
  }
}
