import {
  chmodSync,
  mkdtempSync,
  opendirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  bridgeError,
  checkDirectory,
  directoryIdentity,
  readBounded,
  requestLimit,
  responseLimit,
  writeAtomic,
} from "../bin/managed-client.mjs";

const fields = {
  get_task: [],
  get_resolution_context: [],
  update_task: ["version", "reason", "changes"],
  create_subtask: ["reason", "title", "description", "brief"],
  report_progress: [
    "type",
    "summary",
    "progress",
    "prUrl",
    "headSha",
    "eventId",
  ],
};
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const requestPattern =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.request\.json$/;

// The parent retains all credentials and fixes every execution identity here.
export function createManagedBridge({
  service,
  execution,
  worktree,
  sendEvent,
}) {
  if (!/^[\w-]{1,100}$/.test(execution.id))
    throw Error("Invalid managed execution identifier.");
  const directory = mkdtempSync(
    join(realpathSync(worktree), `.agent-desk-${execution.id}-`),
  );
  chmodSync(directory, 0o700);
  writeFileSync(join(directory, ".gitignore"), "*\n", {
    mode: 0o600,
    flag: "wx",
  });
  const identity = directoryIdentity(directory);
  const scope = {
    agentId: execution.agentId,
    executionId: execution.id,
    sessionId: execution.sessionId,
  };
  const pending = new Set(),
    consumed = new Set(),
    eventResults = new Map();
  let queue = Promise.resolve(),
    closed = false;
  const invoke = async (operation, input) => {
    if (!Object.hasOwn(fields, operation))
      throw bridgeError(
        "BRIDGE_OPERATION",
        "Unknown managed reporting operation.",
      );
    if (
      !object(input) ||
      Object.keys(input).some((key) => !fields[operation].includes(key))
    )
      throw bridgeError(
        "BRIDGE_FIELDS",
        "Only this operation's task fields are accepted; execution identities are parent-owned.",
      );
    if (
      operation === "report_progress" &&
      input.eventId !== undefined &&
      (typeof input.eventId !== "string" ||
        !input.eventId ||
        input.eventId.length > 200)
    )
      throw bridgeError("BRIDGE_FIELDS", "Invalid progress event identifier.");
    const eventKey =
      operation === "report_progress" ? input.eventId : undefined;
    const eventDigest = JSON.stringify(
      Object.fromEntries(
        Object.keys(input)
          .sort()
          .map((key) => [key, input[key]]),
      ),
    );
    if (eventKey && eventResults.has(eventKey)) {
      const current = service.store.execution(execution.id);
      if (
        current?.agentId !== scope.agentId ||
        current?.sessionId !== scope.sessionId ||
        service.require("ticket", execution.ticketId).ownerId !== scope.agentId
      )
        throw bridgeError(
          "SESSION_MISMATCH",
          "The reporting execution or assignment changed.",
        );
      const prior = eventResults.get(eventKey);
      if (prior.digest !== eventDigest)
        throw bridgeError(
          "EVENT_CONFLICT",
          "An event identifier cannot be reused for different progress.",
        );
      return prior.result;
    }
    const owned = service.requireOwnedExecution(execution.ticketId, scope);
    if (operation !== "get_task" && !owned.execution.reportingReadyAt)
      throw bridgeError(
        "REPORTING_HANDSHAKE",
        "Read get_task before reporting or reorganizing managed work.",
      );
    if (operation === "get_task") {
      const result = service.getTicket(execution.ticketId);
      if (!owned.execution.reportingReadyAt) {
        service.store.saveExecution({
          ...owned.execution,
          reportingReadyAt: new Date().toISOString(),
        });
        service.changed();
      }
      return result;
    }
    if (operation === "get_resolution_context")
      return service.resolutionContext(execution.ticketId, scope);
    if (operation === "update_task")
      return service.agentUpdate(execution.ticketId, { ...input, ...scope });
    if (operation === "create_subtask")
      return service.createSubtask(execution.ticketId, { ...input, ...scope });
    const { type, summary, ...extra } = input;
    extra.eventId ??= randomUUID();
    const result =
      (sendEvent
        ? await sendEvent(type, summary, extra)
        : service.event(execution.id, {
            ...extra,
            type,
            summary,
            ...scope,
            seq: owned.execution.lastSeq + 1,
          })) ?? service.store.execution(execution.id);
    if (eventKey) eventResults.set(eventKey, { digest: eventDigest, result });
    return result;
  };
  const processRequest = async (name, id) => {
    let message;
    try {
      checkDirectory(directory, identity);
      const data = JSON.parse(readBounded(join(directory, name), requestLimit));
      if (
        !object(data) ||
        data.id !== id ||
        Object.keys(data).some((k) => !["id", "operation", "input"].includes(k))
      )
        throw bridgeError("BRIDGE_FIELDS", "Invalid managed request envelope.");
      if (closed)
        throw bridgeError("BRIDGE_CLOSED", "Managed reporting is closed.");
      message = {
        id,
        ok: true,
        result: await invoke(data.operation, data.input ?? {}),
      };
    } catch (error) {
      message = {
        id,
        ok: false,
        error: {
          code: error.code ?? "BRIDGE_ERROR",
          message:
            error.status ||
            String(error.code ?? "").startsWith("BRIDGE_") ||
            error.code === "EVENT_CONFLICT"
              ? error.message
              : "Unable to process managed reporting request.",
        },
      };
    }
    try {
      try {
        writeAtomic(
          directory,
          identity,
          `${id}.response.json`,
          message,
          responseLimit,
        );
      } catch (error) {
        if (error.code !== "BRIDGE_FILE") throw error;
        writeAtomic(
          directory,
          identity,
          `${id}.response.json`,
          {
            id,
            ok: false,
            error: {
              code: "BRIDGE_FILE",
              message: "Unable to return bounded managed context.",
            },
          },
          responseLimit,
        );
      }
      checkDirectory(directory, identity);
      unlinkSync(join(directory, name));
    } catch {
    } finally {
      pending.delete(id);
      consumed.add(id);
    }
  };
  const scan = () => {
    if (closed) return;
    let entries;
    try {
      checkDirectory(directory, identity);
      entries = opendirSync(directory);
      for (
        let count = 0, entry;
        count < 512 && (entry = entries.readSync());
        count++
      ) {
        const match = requestPattern.exec(entry.name);
        if (!match || pending.has(match[1]) || consumed.has(match[1])) continue;
        if (consumed.size + pending.size >= 4096) {
          close();
          break;
        }
        pending.add(match[1]);
        queue = queue
          .then(() => processRequest(entry.name, match[1]))
          .catch(() => {});
      }
    } catch {
    } finally {
      entries?.closeSync();
    }
  };
  const timer = setInterval(scan, 250);
  timer.unref();
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    try {
      writeAtomic(directory, identity, ".closed", { closed: true }, 1024);
    } catch {}
  };
  return {
    directory,
    close,
    async flush() {
      scan();
      await queue;
    },
  };
}
