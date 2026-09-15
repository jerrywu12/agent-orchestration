# Phase 0 Research: Background AI agent activity tracking

**Feature**: specs/011-agent-activity-tracking | **Date**: 2026-09-15

All measurements below were taken on the target Mac (Darwin 25.6.0, Node v22.23.1) against the live Codex state source and process table. They are reproducible with the probe described in [quickstart.md](./quickstart.md).

---

## R-001: Reading the Codex task source safely and cheaply

**Decision**: Open the Codex state database with `node:sqlite` `DatabaseSync(path, { readOnly: true })`, apply `PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=50`, run one prefiltered `SELECT`, and close. Reuse the path-hardening precedent in `server/legacy-observer.mjs` `openSource()` verbatim in shape: `realpathSync` identity check on the file and its parent, `lstatSync` regular-file check, and rejection when the `-wal` / `-shm` sidecars exist but are not regular files.

**Rationale**: Measured cost of open + prefiltered query against the live 106 MB WAL-mode database is **4 ms**. `readOnly` plus `query_only` means the reader cannot write, cannot checkpoint the WAL and cannot recover the database on behalf of the owning application, satisfying FR-015. `busy_timeout=50` guarantees we yield almost immediately rather than blocking Codex mid-write. The sidecar symlink check matters because the WAL sidecars are present on this machine and are an injection path that the main-file check alone would miss.

**Alternatives considered**:
- *Shelling out to `sqlite3`* (what the superseded indicator does) — rejected: spawns a process every cycle, inherits shell quoting risk, and returns untyped tab-delimited text that must be re-parsed.
- *Copying the database before reading* — rejected: 106 MB copy per cycle, and `readOnly` already makes the copy pointless.
- *Watching the file for changes* — rejected: WAL-mode writes do not reliably produce useful `fs.watch` events on the main file, and a 4 ms poll is cheaper than maintaining a watcher.

---

## R-002: Locating the task source across schema generations

**Decision**: Do not hardcode a filename. Enumerate `state_<N>.sqlite` in the Codex state root, select the highest `N`, then validate the `threads` table through `PRAGMA table_xinfo` and require every column the query reads (`id`, `rollout_path`, `updated_at`, `archived`, `source`, `cwd`, `title`). On absence or shape mismatch, report the task source as `unobservable` with a fixed reason.

**Rationale**: The live filename is `state_5.sqlite` — the `5` is a generation counter that the upstream application increments on schema change, and the directory still holds older generations. Hardcoding `state_5` guarantees silent breakage on the next Codex upgrade, and the failure mode would be the dangerous one: zero active tasks reported while tasks are running (violating FR-011 and SC-005). Column validation before projection is the same defence `legacy-observer.mjs` already applies.

**Alternatives considered**:
- *Hardcode `state_5.sqlite`* — rejected: the superseded indicator does exactly this and will fail silently.
- *Make the path configurable* — rejected for now: a setting that nobody updates fails the same way. Discovery is self-healing. A configuration override can be added later if discovery proves insufficient.

---

## R-003: Determining the lifecycle marker without reading transcripts

**Decision**: Read a bounded window from the **end** of each candidate thread's rollout file and take the last `task_started` / `task_complete` marker occurrence. Escalate in two steps: 256 KiB, then 4 MiB. If neither window contains a marker, classify that thread `indeterminate` — never silently inactive — and surface it as partial coverage.

**Rationale**: Measured on 245 threads over seven days: a 256 KiB tail resolves **225 (91.8 %)**; **20 (8.2 %)** contain no marker in that window. Rollout files reach **19.6 MB** (median 1.26 MB), so an unbounded scan is not acceptable on a 15-second cadence. The 8.2 % matter because the dangerous case is a task that started and then emitted more than 256 KiB of output before finishing: its `task_started` scrolls out of the tail with no `task_complete` yet, and treating "no marker" as inactive would report a busy task as idle. Escalation plus an explicit `indeterminate` state is honest about what was not resolved, where both the superseded indicator's unbounded scan and a naive fixed tail are not. Full-run cost for the 24-hour candidate set (22 threads) is **13 ms including the database query**.

**Alternatives considered**:
- *Unbounded full-file scan on tail miss* (what the superseded indicator does, via `rg`) — rejected: up to 19.6 MB × misses per cycle, unbounded by design, and it violates FR-014.
- *Treat a tail miss as inactive* — rejected: produces exactly the false-negative this feature exists to prevent.
- *Parse the rollout as JSONL and read event objects* — rejected: that means parsing transcript content. Byte-scanning for a fixed marker token reads strictly less than parsing and keeps FR-019 easy to prove.

**Constraint carried into implementation**: the scan reads raw bytes only to locate a fixed marker token. No decoded rollout content may be retained past the scan or placed in the snapshot.

---

## R-004: Classifying task origin without leaking subagent identity

**Decision**: Map the `source` column to a closed set — `Codex app` (`vscode`), `Automation/CLI` (`exec`), `Codex` (`cli`), `Subagent` (any structured value whose shape indicates a subagent), `Codex` (anything else). Detect the subagent case by shape only. Never parse, retain or expose the nested fields.

**Rationale**: `source` is not the simple enum the superseded indicator's `case` statement assumes. Live distribution over seven days: **structured JSON 169 (69 %)**, `exec` 71, `vscode` 4, `cli` 1. The structured values are spawn records carrying `parent_thread_id`, `agent_path` and `agent_nickname` — for example an `agent_path` of `/root/phase_a_migration_w0_doubt`, which is user-authored work naming. Those fields are precisely what FR-019 forbids surfacing, and because the structured form is the *majority* case, a classifier that falls through and stringifies the raw value would leak on most rows rather than rarely.

**Alternatives considered**:
- *Glob-match `*subagent*` against the raw string* (superseded indicator's approach) — accepted as the detection signal, rejected as the display value. The match is fine; echoing the matched string is not.
- *Expose the subagent nickname as useful context* — rejected: it is derived from user-authored naming, and FR-019 admits no exception.

---

## R-005: Sleep-prevention detection — the superseded indicator is currently wrong

**Decision**: Detect sleep prevention by locating `caffeinate` processes that hold a system or idle assertion, and classify a hold as agent-linked when the holder is a known agent-linked wrapper or when its process ancestry reaches a tracked agent process. Do not match a hardcoded absolute binary path.

> **Refinement (2026-09-15, before US2 implementation).** Wrapper recognition is the **primary and only currently-exercised** path on this Mac. Ancestry-to-a-tracked-agent is a fallback for other wrapper styles and has no live test data here. Measured ancestry is:
>
> ```text
> launchd (1) → agent_caffeinate_watch.sh (1614) → caffeinate -is (2195)
> ```
>
> The wrapper is a LaunchAgent (`com.jerry.agent-caffeinate`) with **ppid 1**, so a hold's ancestry reaches the *wrapper* and never reaches a tracked agent process. An implementation that only walked ancestry looking for an agent would detect nothing on this machine. Classify by recognizing the wrapper, and treat its `caffeinate` child as agent-linked by construction.
>
> The signal is genuinely informative rather than always-on: the wrapper polls every 30 s and holds the assertion *only* while a matching agent process exists, releasing it when agent work finishes. A long elapsed time means sustained agent activity, not a stuck hold.
>
> The wrapper's own detection list covers Claude, Gemini, Codex `exec`, Antigravity and ArkCLI, but **not** Cursor or Hermes — its notion of "agent work" is narrower than Agent Desk's tracked-agent set. The two are independent and must not be assumed equivalent.

**Rationale**: This is a correctness fix, not a port. The superseded indicator matches the literal pattern `caffeinate -i /opt/homebrew/bin/codex`. On this Mac **that pattern currently matches zero processes**, so the indicator reports "Codex-linked sleep prevention: inactive" — while sleep prevention *is* in force, held by `caffeinate -is` (PID 2195) under `/Users/jerry/.local/bin/agent_caffeinate_watch.sh` (PID 1614), both running for ~13 hours. The indicator's panel has therefore been silently wrong for as long as the watch script has been the mechanism. Reproducing the regex would import a live defect into Agent Desk and would fail SC-010 parity in the correct direction — Agent Desk must be right, and the parity record must note this as a known, intentional divergence.

**Alternatives considered**:
- *Port the regex as-is for exact parity* — rejected: parity with a broken signal is not the goal; FR-008 asks whether sleep prevention is in force.
- *Query `pmset -g assertions`* — rejected for now: richer, but spawns another process and returns a free-form report that changes between OS releases. `ps` ancestry is already available from the process read the feature performs anyway. Recorded as a future refinement.

**Flagged for the parity record**: expect Agent Desk to report sleep prevention *active* where the indicator reports *inactive*. That difference is the fix, and SC-010's comparison must be evaluated with it stated explicitly rather than treated as a parity failure.

---

## R-006: Elapsed runtime from the process table

**Decision**: Read `/bin/ps -axo pid=,ppid=,etime=,command=`, parse `etime` (`[[DD-]HH:]MM:SS`) into integer seconds server-side, and expose only integer seconds. The UI formats for display.

**Rationale**: macOS `ps` does **not** support the `etimes` keyword (verified: `ps: etimes: keyword not found`), so the pre-converted seconds field available on Linux is not an option and `etime` must be parsed. Converting server-side keeps a single parser under test and prevents a platform-specific string format from reaching the client contract.

**Note on `command=`**: full command lines must be read, because agent identity cannot otherwise be distinguished (see R-007). They are used for matching only. FR-019 forbids any command argument reaching the snapshot, so the matcher must return a classification and the raw command string must be discarded at that boundary.

---

## R-007: Distinguishing background workers from look-alikes

**Decision**: Carry over the superseded indicator's exclusion set as explicit, individually tested rules: a CLI worker matches an absolute path ending in the agent's binary name, and is excluded when it is under the agent's desktop application bundle, under an IDE extensions directory, or is an IDE language-server helper without the agent's own flag.

**Rationale**: These exclusions are the accumulated correctness of the script and each represents a real observed false positive — the desktop application versus the CLI sharing a name, IDE-bundled helpers, and the indicator's own process matching its own pattern. They are currently encoded as untested shell conditionals; the value of the migration is that each becomes a named unit test (SC-003). `machine-inventory.mjs` `processMatch()` already solves the adjacent generic-interpreter problem (`node`/`python` must not be attributed to an agent) and its scoring approach is the model to follow.

**Alternatives considered**:
- *Reuse `probeMachine`'s existing `comm=`-based matching* — rejected: `comm` gives the executable name without arguments, which cannot separate an IDE helper from an agent worker, and carries no elapsed time.

---

## R-008: Where the observation lives

**Decision**: A new `server/agent-activity.mjs` exporting a pure collector and an `AgentActivityMonitor` class that mirrors `MachineMonitor`'s lifecycle contract — constructor-injected collectors, `snapshot()`, coalescing `refresh()`, retained-stale-on-failure, `close()` aborting in-flight work, `unref()`ed timer. Surfaced at `/api/activity`, rendered as a section within the existing Machine view.

**Rationale**: `machine-inventory.mjs` is already 1247 lines and `probeMachine` is inventory-coupled — it iterates the discovered agent catalog. Activity has a different source set, a different failure model (per-source degradation, FR-011) and a different cadence requirement, and folding the escalating rollout scan into `probeMachine` would let a slow task-source read stall runtime sampling, which `MachineMonitor` explicitly works to avoid. A sibling module with the same proven lifecycle shape gets the reuse without the coupling. Placing the UI in the Machine view follows spec assumption A-003.

**Accepted cost**: two `ps` invocations per 15-second cycle (inventory's `comm=` read and activity's `command=` read). Measured as negligible, and sharing one read would couple the two monitors' schedules — the coupling this decision exists to avoid.

---

## R-009: Access control requires no new mechanism

**Decision**: Add no authorization code. Verify by test that the agent-role path denies `/api/activity`.

**Rationale**: `server/http.mjs` gates agent-role actors through an explicit allowlist and fails anything absent from it with `403 AGENT_SCOPE` (`http.mjs:271`). A new `activity` resource is therefore denied by default, and admin/loopback resolution already governs the rest. FR-020 and SC-009 are satisfied by the existing design; the only work is the regression test that proves it and keeps it true.

---

## R-010: Counting and the unobservable-source fallback

**Decision**: Active count = active Codex **tasks** + active non-Codex **workers**. Codex is deliberately counted at task granularity, not process granularity. When the task source is unobservable, fall back to the Codex *process* count, and mark the snapshot partial with the reason.

**Rationale**: This resolves FR-009 — one Codex process may host several threads and one thread may outlive a process, so mixing granularities double-counts. The fallback preserves a useful count when the database cannot be read, which is exactly the schema-drift case R-002 anticipates, and mirrors the superseded indicator's `display_codex_count` fallback while stating the degradation that the indicator leaves invisible.

---

## Resolved unknowns

| Unknown | Resolution |
|---|---|
| Can `node:sqlite` read the live WAL database safely? | Yes — `readOnly` + `query_only`, 4 ms (R-001) |
| How expensive is lifecycle detection? | 13 ms for the 24-hour candidate set with a bounded tail (R-003) |
| Is a tail sufficient? | No — 8.2 % miss rate; escalate, then report `indeterminate` (R-003) |
| Is `source` a simple enum? | No — 69 % structured JSON carrying sensitive naming (R-004) |
| Is `etimes` available on macOS? | No — `etime` must be parsed (R-006) |
| Does the existing caffeinate detection work? | No — it reports inactive while sleep prevention is held (R-005) |
| Does activity need new authorization code? | No — allowlist denies by default (R-009) |

No `NEEDS CLARIFICATION` items remain.
