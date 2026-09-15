# Contract: Activity API

**Feature**: specs/011-agent-activity-tracking | **Date**: 2026-09-15

Two routes added to `tools/agent-desk/server/http.mjs`, following the shape of the existing `/api/machine` pair. Entity field rules live in [data-model.md](../data-model.md) and are not repeated here.

---

## `GET /api/activity`

Returns the current `ActivitySnapshot`. Never blocks on an in-flight observation — returns the current or retained snapshot immediately.

**Auth**: administrator only. Agent-role credentials receive `403 AGENT_SCOPE`; unauthenticated non-loopback requests receive `401`. No new authorization code — `activity` is absent from the agent allowlist and is therefore denied by default (R-009).

**Responses**

| Status | Meaning |
|---|---|
| `200` | Snapshot returned (including `stale`, `partial` and `unobservable` states) |
| `401` | Unauthenticated |
| `403` | Agent-scoped credential (`AGENT_SCOPE`) |
| `404` | Unknown activity path (`NOT_FOUND`) |
| `503` | Monitor not constructed (`ACTIVITY_UNAVAILABLE`) |

An unobservable source is **not** an error status. It is a `200` whose `sources[]` carries the condition — a failed read must never present as a transport failure, and must never present as zero work (FR-011, SC-005).

**Example — active**

```json
{
  "activeCount": 3,
  "state": "active",
  "tasks": [
    {
      "id": "019f4b72",
      "agentId": "codex",
      "origin": "Subagent",
      "description": "Reconcile planning stage transitions",
      "workspace": "agent-orchestrator",
      "lifecycle": "active"
    }
  ],
  "workers": [
    { "agentId": "claude", "agentName": "Claude Code", "pid": 45012, "elapsedSeconds": 1874 },
    { "agentId": "agy", "agentName": "Antigravity CLI", "pid": 45330, "elapsedSeconds": 96 }
  ],
  "sleepPrevention": {
    "state": "active",
    "holders": [{ "pid": 2195, "elapsedSeconds": 46709 }]
  },
  "sources": [
    { "id": "codex-tasks", "label": "Codex tasks", "status": "observed", "reason": null, "retained": false },
    { "id": "processes",   "label": "Processes",   "status": "observed", "reason": null, "retained": false }
  ],
  "observedAt": "2026-09-15T09:14:02.411Z",
  "stale": false,
  "partial": false,
  "truncated": false,
  "refreshing": false,
  "notes": []
}
```

**Example — partial coverage (task source unreadable, processes fine)**

Note `state` is `"active"`, not `"idle"` and not `"unobservable"`: a worker was positively observed, so the snapshot reports active work, while `partial: true` and the `codex-tasks` entry in `sources[]` carry the failed read. `state` would be `"unobservable"` only if `activeCount` were also `0` — see the invariants and the 2026-09-15 amendment in [data-model.md](../data-model.md). *(This example previously showed `"unobservable"`, which contradicted those invariants; corrected 2026-09-15.)*

```json
{
  "activeCount": 1,
  "state": "active",
  "tasks": [],
  "workers": [
    { "agentId": "claude", "agentName": "Claude Code", "pid": 45012, "elapsedSeconds": 1874 }
  ],
  "sleepPrevention": { "state": "inactive", "holders": [] },
  "sources": [
    {
      "id": "codex-tasks",
      "label": "Codex tasks",
      "status": "unobservable",
      "reason": "The Codex task source uses an unrecognized format and was not read.",
      "retained": false
    },
    { "id": "processes", "label": "Processes", "status": "observed", "reason": null, "retained": false }
  ],
  "observedAt": "2026-09-15T09:14:02.411Z",
  "stale": false,
  "partial": true,
  "truncated": false,
  "refreshing": false,
  "notes": ["Codex task activity is unavailable; the count reflects processes only."]
}
```

**Example — idle**

Only valid when every source reports `observed` (FR-002).

```json
{
  "activeCount": 0,
  "state": "idle",
  "tasks": [],
  "workers": [],
  "sleepPrevention": { "state": "inactive", "holders": [] },
  "sources": [
    { "id": "codex-tasks", "label": "Codex tasks", "status": "observed", "reason": null, "retained": false },
    { "id": "processes",   "label": "Processes",   "status": "observed", "reason": null, "retained": false }
  ],
  "observedAt": "2026-09-15T09:14:02.411Z",
  "stale": false,
  "partial": false,
  "truncated": false,
  "refreshing": false,
  "notes": []
}
```

---

## `POST /api/activity/refresh`

Requests an immediate observation (FR-010). Returns `202` with the snapshot as it stands; the caller re-reads `GET /api/activity` for the result. Overlapping calls coalesce onto the in-flight observation and do **not** queue additional work (FR-013).

**Body**: none; any body is ignored.

**Responses**: `202` snapshot; `401` / `403` / `503` as above.

---

## Contract guarantees

These are the properties tests must assert, not prose:

1. **No forbidden fields.** No response field anywhere in the payload contains a prompt, transcript fragment, command line or argument, environment value, credential, account identity, absolute filesystem path, full thread identifier, or raw upstream `source` value (FR-019). Assert structurally over the whole payload, not per known field.
2. **Fixed wording only.** Every `reason` and `notes` entry is drawn from the closed set in [data-model.md](../data-model.md). No upstream error text, `errno`, path or stack reaches the client (FR-012).
3. **Zero is never ambiguous.** `state: "idle"` is returned only when every source is `observed`. Any unobservable source with a zero count yields `state: "unobservable"` (SC-005).
4. **Read-only.** Handling either route performs no write to the Agent Desk store, the sync outbox or the Codex source, and sends no signal to any process (FR-015, FR-016).
5. **Non-blocking.** `GET` returns the retained snapshot without awaiting an in-flight observation; a collector at its timeout bound does not delay the response (SC-006).
6. **Bounded.** `tasks` ≤ 200, `workers` ≤ 200, `sleepPrevention.holders` ≤ 50, `notes` ≤ 20; exceeding any bound sets `truncated: true` (FR-014).
7. **Denied by default.** An agent-role token receives `403 AGENT_SCOPE` on both routes — a regression test that keeps the allowlist honest (FR-020, SC-009, R-009).

---

## Client contract

`src/activity-types.ts` mirrors these shapes as TypeScript interfaces — `ActivitySnapshot`, `ActiveTask`, `ActiveWorker`, `SleepPrevention`, `SleepHolder`, `SourceObservability` — following `src/machine-types.ts` in style. The client treats the snapshot as opaque display data: it performs no re-derivation of `activeCount` or `state`, so that the server remains the single authority for the invariants above.
