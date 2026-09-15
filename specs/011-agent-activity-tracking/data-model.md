# Phase 1 Data Model: Background AI agent activity tracking

**Feature**: specs/011-agent-activity-tracking | **Date**: 2026-09-15

All entities are **memory-only**. Nothing here is persisted to the Agent Desk store, the sync outbox, ticket history, exported reports or version control (FR-018). Each successful observation replaces the snapshot wholesale.

---

## ActivitySnapshot

The complete answer to "what agent work is in flight on this machine now".

| Field | Type | Rules |
|---|---|---|
| `activeCount` | integer | ≥ 0. Equals `tasks.length + workers.length`. Codex is counted at task granularity only (R-010, FR-009) |
| `state` | `"active" \| "idle" \| "unobservable"` | `unobservable` when **every** source failed; `idle` only when all sources were observed and nothing is active (FR-002, SC-005) |
| `tasks` | `ActiveTask[]` | Max 200; `truncated` set when capped |
| `workers` | `ActiveWorker[]` | Max 200; `truncated` set when capped |
| `sleepPrevention` | `SleepPrevention` | Always present |
| `sources` | `SourceObservability[]` | One entry per source, always present even when healthy (FR-011) |
| `observedAt` | ISO-8601 string \| null | null before the first successful observation |
| `stale` | boolean | True when retained after a failed or timed-out refresh (FR-012) |
| `partial` | boolean | True when any source failed or any task is `indeterminate` while others succeeded |
| `truncated` | boolean | True when any bound was hit (FR-014) |
| `refreshing` | boolean | True while an observation is in flight |
| `notes` | string[] | Max 20, each ≤ 320 chars. Fixed system wording only — never upstream error text (FR-012) |

**Invariants**

- `state === "idle"` ⟹ `activeCount === 0` **and** no source has `status: "unobservable"`.
- `activeCount === 0` **and** some source unobservable ⟹ `state === "unobservable"`. A zero count must never be presented as "nothing is running" when something could not be read (SC-005).
- `activeCount > 0` ⟹ `state === "active"`, **even when a source is unobservable**. Positively observed work is reported as active; the failed source is carried by `partial: true` and its `sources[]` entry, not by downgrading the state. Saying "cannot observe" while holding proof that a worker is running would understate what is known. *(Added 2026-09-15 — see "Amendment" below.)*
- `stale === true` ⟹ `observedAt` refers to the last *successful* observation, not the failed attempt.

**Amendment (2026-09-15, during implementation)**

The original invariant list did not state what `state` should be when `activeCount > 0` **and** a source is unobservable. The worked "partial coverage" example in [contracts/activity-api.md](./contracts/activity-api.md) silently assumed `"unobservable"` while the first two invariants permitted `"active"`, so the contract was self-inconsistent rather than merely incomplete.

Resolved in favour of `"active"`, and the contract example corrected to match. Rationale: `partial` and the per-source `reason` already carry the degradation without discarding a positive observation, and the invariant that actually protects the administrator — never reporting "nothing is running" when a source failed — is unaffected either way. Recorded here rather than patched silently, per `docs/SPEC_KIT_POLICY.md` ("if implementation reveals a gap, stop and revise the spec/plan explicitly").

---

## ActiveTask

A unit of agent work observed to have started and not finished.

| Field | Type | Rules |
|---|---|---|
| `id` | string | Shortened identifier — first 8 chars of the upstream thread id, `[0-9a-f-]` only. Never the full identifier |
| `agentId` | string | Tracked agent id, e.g. `codex` |
| `origin` | `"Codex" \| "Codex app" \| "Automation/CLI" \| "Subagent"` | Closed set. Any unrecognized or structured value maps to `"Codex"` (FR-005, R-004) |
| `description` | string | 1–60 chars after normalization. Tabs, newlines, carriage returns and control chars stripped; `\|` replaced; empty → `"Untitled task"` (FR-004, FR-019) |
| `workspace` | string | **Final path segment only**, ≤ 60 chars. Never an absolute path. Empty → `"—"` (FR-019) |
| `lifecycle` | `"active" \| "indeterminate"` | `indeterminate` when no marker was found within the escalation bound (R-003) |

**Derivation rules**

- A thread is a candidate only when `archived = 0` and `updated_at >= now - 86400`.
- `lifecycle: "active"` requires the **last** marker in the scanned window to be `task_started`.
- Last marker `task_complete` ⟹ excluded entirely (FR-003, acceptance 1.2).
- No marker found in either escalation window ⟹ `indeterminate`, included in `tasks`, counted, and sets `partial`.
- No marker because the thread never emitted one ⟹ **excluded** (FR-003, acceptance 1.3). Distinguished from `indeterminate` by whether the full file was within the escalation bound.

**Forbidden**: the raw `source` value, `agent_path`, `agent_nickname`, `parent_thread_id`, `first_user_message`, `preview`, `git_*`, absolute `cwd`, `rollout_path`, or any decoded rollout content (FR-019, R-004).

---

## ActiveWorker

A background agent process observed to be running.

| Field | Type | Rules |
|---|---|---|
| `agentId` | string | Tracked agent id — `claude`, `gemini`, `agy`, … |
| `agentName` | string | Display name from the existing agent definitions |
| `pid` | integer | > 0, safe integer |
| `elapsedSeconds` | integer | ≥ 0. Parsed from `etime` server-side (R-006) |

**Inclusion**: an absolute executable path ending in the agent's binary name, or a recognized interpreter invocation of the agent's package entry point.

**Exclusion** — each is a named test case (SC-003, R-007):

1. Under the agent's desktop application bundle (`/Applications/<Agent>.app/...`).
2. Under an IDE extensions directory (`.../extensions/...`).
3. An IDE language-server helper lacking the agent's own flag.
4. The observer's own process or tooling.
5. Codex processes — Codex is counted as tasks (R-010), except in the `unobservable`-source fallback.

**Forbidden**: the command line, its arguments, the working directory, or any environment value (FR-019, R-006).

---

## SleepPrevention

| Field | Type | Rules |
|---|---|---|
| `state` | `"active" \| "inactive" \| "unobservable"` | `active` only when ≥ 1 agent-linked hold is observed (FR-008) |
| `holders` | `SleepHolder[]` | Max 50. `{ pid: integer > 0, elapsedSeconds: integer ≥ 0 }` |

**Agent-linked** means the holder is a recognized agent-linked sleep-prevention wrapper, or its process ancestry reaches a tracked agent process. A hold with no agent linkage is **not** reported (acceptance 2.3).

**Forbidden**: wrapper script paths, command lines, assertion reason strings.

---

## SourceObservability

One per source, always present — a healthy source reports itself healthy (FR-011).

| Field | Type | Rules |
|---|---|---|
| `id` | `"codex-tasks" \| "processes"` | Fixed set |
| `label` | string | Fixed display label |
| `status` | `"observed" \| "unobservable"` | Independent per source |
| `reason` | string \| null | Non-null only when `unobservable`. **Fixed system wording**, ≤ 320 chars, selected from a closed set — never an upstream error message, path or stack (FR-012) |
| `retained` | boolean | True when prior values for this source are being shown despite the failure |

**Closed reason set**

| Condition | Wording |
|---|---|
| No `state_<N>.sqlite` found | `"The Codex task source was not found on this machine."` |
| Column/shape validation failed | `"The Codex task source uses an unrecognized format and was not read."` |
| Open/query failed or timed out | `"The Codex task source could not be read; it may be in use."` |
| Non-darwin/linux platform | `"Process observation is unsupported on this platform."` |
| `ps` failed, empty or malformed | `"Process metadata could not be observed."` |
| Not running directly on the host | `"Host activity cannot be observed from inside a container."` (FR-017) |

---

## State transitions

**Snapshot lifecycle** — mirrors `MachineMonitor` (R-008):

```text
initial ──first successful observation──▶ fresh (stale=false)
fresh ──refresh succeeds──▶ fresh                  (replaced wholesale)
fresh ──refresh fails/times out──▶ retained stale  (stale=true, prior values kept, note added)
retained stale ──refresh succeeds──▶ fresh
any ──close()──▶ terminal (in-flight work aborted, no further transitions)
```

Overlapping refreshes coalesce onto the in-flight promise (FR-013). A failure never replaces good data with an error (FR-012, SC-006).

**Per-source status is independent**: `codex-tasks` failing while `processes` succeeds yields `partial: true`, a populated `workers` list, an empty `tasks` list, and `state` determined by the Codex *process* fallback (R-010) — never `idle`.

---

## Bounds summary (FR-014)

| Bound | Value | Source |
|---|---|---|
| Task candidate recency | 24 hours | Matches superseded indicator |
| Lifecycle tail window | 256 KiB, escalating to 4 MiB | R-003 (91.8 % resolved at 256 KiB) |
| SQLite busy timeout | 50 ms | R-001 |
| `ps` output cap | 2 MiB / 10 000 rows | Existing `probeMachine` precedent |
| Tasks / workers per snapshot | 200 each | New |
| Sleep holders | 50 | New |
| Notes | 20 × 320 chars | Existing `MachineMonitor` precedent |
| Collector timeout | 8 s | Existing `probeTimeoutMs` precedent |
| Refresh interval | 15 s | Existing `runtimeIntervalMs`; satisfies SC-004 |
