import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { request } from "./client.mjs";

// Board credentials belong to this invocation. Provider configuration stays local.
export function agentEnvironment(inherited, scoped) {
  return {
    ...Object.fromEntries(
      Object.entries(inherited).filter(
        ([key]) => !key.startsWith("AGENT_DESK_"),
      ),
    ),
    ...scoped,
  };
}

export function eventReporter({
  run,
  agentId,
  sessionId,
  config,
  send = request,
  delay = wait,
}) {
  let seq = run.lastSeq;
  let queue = Promise.resolve();
  return (type, summary) => {
    const body = {
      agentId,
      sessionId,
      eventId: randomUUID(),
      seq: 0,
      type,
      summary,
    };
    const next = queue.then(async () => {
      body.seq = ++seq;
      for (let attempt = 0; ; attempt++) {
        try {
          return await send(
            "POST",
            `/api/executions/${encodeURIComponent(run.id)}/events`,
            body,
            config,
          );
        } catch (error) {
          if (
            ["STALE_EVENT", "EXECUTION_FINISHED"].includes(error.code) &&
            attempt < 2
          ) {
            const state = await send("GET", "/api/state", undefined, config);
            const current = state.tickets.find(
              (ticket) => ticket.execution?.id === run.id,
            )?.execution;
            if (!current || current.sessionId !== sessionId) throw error;
            if (current.releasedAt) return current;
            seq = Math.max(seq, current.lastSeq);
            body.seq = ++seq;
            continue;
          }
          const retryable =
            !error.status || error.status === 429 || error.status >= 500;
          if (!retryable || attempt >= 2) throw error;
          await delay(250 * 2 ** attempt);
        }
      }
    });
    // Surface each failure to its caller without poisoning the following event.
    queue = next.catch(() => {});
    return next;
  };
}
