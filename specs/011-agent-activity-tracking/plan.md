# Implementation Plan: Background AI agent activity tracking

**Branch**: `claude/ai-agent-activity-tracking-47d573` | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/011-agent-activity-tracking/spec.md`

## Summary

Agent Desk gains a read-only activity observation that answers "what AI agent work is in flight on this Mac right now" — active Codex tasks with origin, description and workspace; active Claude Code / Gemini / Antigravity workers with elapsed runtime; agent-linked sleep-prevention state; and one glanceable count. It lands as a sibling of the existing machine observation: a new `server/agent-activity.mjs` holding a pure collector plus an `AgentActivityMonitor` that copies `MachineMonitor`'s proven lifecycle contract, a new `/api/activity` route pair, and a new section in the existing Machine view. No new dependencies, no schema migration, no change to existing behaviour.

Two research findings shape the build and are not negotiable details (see [research.md](./research.md)): the Codex `source` column is structured JSON carrying user-authored subagent naming in 69 % of rows, so origin classification must be shape-detection only; and the superseded indicator's sleep-prevention check currently matches nothing while sleep prevention is actually held, so that logic is corrected rather than ported.

## Technical Context

**Language/Version**: JavaScript (ES modules) on Node.js v22.23.1 for the server; TypeScript + React for the client. Matches the existing `tools/agent-desk` stack exactly.

**Primary Dependencies**: None added. Server uses `node:sqlite` (`DatabaseSync`, already used by `server/legacy-observer.mjs`), `node:child_process`, `node:fs`. Client uses the existing React setup.

**Storage**: None. Activity is memory-only and never touches the SQLite store, the sync outbox or any persisted record (FR-018). The feature *reads* an external SQLite database owned by Codex, strictly read-only.

**Testing**: `node --test` for server units (`tests/*.test.mjs`), Playwright for DOM behaviour (`tests/*.spec.ts`). Both already configured.

**Target Platform**: macOS (Darwin) host running Agent Desk directly. Linux degrades where supported; every other platform and any container reports `unobservable` with a reason.

**Project Type**: Local web service with a React client — existing Agent Desk structure.

**Performance Goals**: Snapshot request returns < 3 s (SC-006); measured collector cost is 13 ms for the live 24-hour candidate set. Refresh cadence 15 s, matching `MachineMonitor`'s runtime interval and satisfying SC-004's 30 s bound.

**Constraints**: Read-only against another application's live database; every read bounded in time, bytes and item count (FR-014); no prompts, transcripts, command arguments, credentials or absolute paths in output (FR-019); no existing ticket, stage, claim or capacity state altered (FR-016).

**Scale/Scope**: Single machine, single administrator. Live scale: 22 candidate threads in a 24-hour window (245 over 7 days), rollout files up to 19.6 MB, a few hundred processes. Bounds: 200 tasks, 200 workers, 50 sleep-prevention holders per snapshot.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled Spec Kit template and defines no project principles. Per `docs/SPEC_KIT_POLICY.md` the canonical governing rules for this repository are `AGENTS.md`, so the gates below are evaluated against it.

| Gate (from AGENTS.md) | Status | Evidence |
|---|---|---|
| Read-only observation; preserve installed agents, sessions, credentials and source data | PASS | `readOnly` + `query_only` + `busy_timeout=50`; no writes, no migration, no process signalling (R-001, FR-015) |
| No secrets, config values, environment variables, full command arguments, transcripts or prompts in snapshots, logs or version control | PASS | Origin is shape-classified to a closed set; descriptions bounded and normalized; workspace reduced to final path segment; command lines used for matching then discarded (R-004, R-006, FR-019) |
| No broad recursive disk scan | PASS | One prefiltered query plus bounded tail reads of already-named files (R-003) |
| Existing execution claims and stages never changed by observation | PASS | Feature holds no store handle for writes; FR-016 asserted by test |
| Machine-local deployment is a separate explicit step from a source edit | PASS | Indicator removal is FR-022, gated on recorded parity evidence, out of the code change |
| New feature contracts under `specs/` via Spec Kit | PASS | This artifact set |
| Agent Desk verification uses code, scripts, API checks and automated DOM tests — never computer control or screenshots | PASS | All verification in [quickstart.md](./quickstart.md) is `node --test`, Playwright and `curl` |
| Implementation owned by the assigned executor, not the planning agent | PASS | This plan is a handoff artifact; no implementation performed. Jerry has explicitly assigned implementation to **Antigravity** for this feature rather than the usual Codex lane — permitted by `AGENTS.md` ("unless the user assigns work differently") and by `GEMINI.md` ("independent work explicitly assigned by the user"). See [handoff-antigravity.md](./handoff-antigravity.md) |

**Result**: no violations, Complexity Tracking not required.

**Post-Phase-1 re-check**: still PASS. The design adds one server module, one route pair, one types file and one UI section; it introduces no new dependency, no persistence, no new authorization mechanism (R-009) and no change to an existing contract.

## Project Structure

### Documentation (this feature)

```text
specs/011-agent-activity-tracking/
├── spec.md              # Phase -1 output (/speckit-specify)
├── plan.md              # This file (/speckit-plan)
├── research.md          # Phase 0 output — measured findings and decisions
├── data-model.md        # Phase 1 output — entities, validation, states
├── quickstart.md        # Phase 1 output — runnable validation guide
├── contracts/
│   └── activity-api.md  # Phase 1 output — /api/activity contract
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
tools/agent-desk/
├── server/
│   ├── agent-activity.mjs        # NEW — collectors + AgentActivityMonitor
│   ├── http.mjs                  # EDIT — /api/activity routes, wire monitor, close()
│   ├── machine-inventory.mjs     # REFERENCE ONLY — processMatch() scoring model
│   ├── machine-monitor.mjs       # REFERENCE ONLY — lifecycle contract to mirror
│   └── legacy-observer.mjs       # REFERENCE ONLY — openSource() SQLite hardening
├── src/
│   ├── activity-types.ts         # NEW — client contract types
│   ├── components/
│   │   ├── AgentActivity.tsx     # NEW — activity section component
│   │   └── MachineView.tsx       # EDIT — render the activity section
│   └── styles.css                # EDIT — activity section styles
└── tests/
    ├── agent-activity.test.mjs   # NEW — collector/monitor units, fixture-driven
    ├── activity-http.test.mjs    # NEW — route contract + agent-scope denial
    ├── activity-browser.spec.ts  # NEW — DOM states
    └── fixtures/activity/        # NEW — seeded DB, rollout and ps fixtures
```

**Structure Decision**: The existing Agent Desk layout is kept unchanged — server modules in `server/`, client types at `src/`, components in `src/components/`, tests in `tests/`. Activity is a sibling module to machine observation rather than an extension of it (R-008): `machine-inventory.mjs` is already 1247 lines and its `probeMachine` is coupled to the discovered agent catalog, while activity has a different source set, a different per-source failure model and an escalating read that must not be able to stall runtime sampling.

## Implementation phases

**Phase A — Collector core (P1 foundation).** `agent-activity.mjs`: source discovery and validation (R-002), hardened read-only query (R-001), bounded escalating lifecycle scan (R-003), origin classification (R-004), `etime` parsing and worker matching with the full exclusion set (R-006, R-007). All collectors constructor-injected so tests never touch the real machine.

**Phase B — Monitor and route (P1 delivery).** `AgentActivityMonitor` mirroring `MachineMonitor` — coalescing refresh, retained-stale-on-failure, per-source observability, bounded abort, `unref()`ed 15 s timer, `close()`. `GET /api/activity` and `POST /api/activity/refresh` in `http.mjs`, wired into construction and shutdown alongside `machineMonitor`. Includes the agent-scope denial test (R-009).

**Phase C — Client surface (P1 delivery).** `activity-types.ts` and `AgentActivity.tsx` rendered inside `MachineView`: count with state, task rows, worker rows, and the three distinct states — active / none active / cannot observe (SC-005). Playwright coverage for each state plus stale and partial-coverage indicators.

**Phase D — Sleep prevention (P2).** Caffeinate hold detection and agent-linkage classification (R-005). Separated deliberately: it is P2 in the spec, it is a behaviour *correction* rather than a port, and Phases A–C are shippable without it.

**Phase E — Parity and retirement (P3).** Capture both signals at one moment, record the comparison including the expected sleep-prevention divergence from R-005, then remove the indicator as a separate authorized machine-local step (FR-022).

## Risks

| Risk | Mitigation |
|---|---|
| Codex bumps the state schema generation and breaks the read | Generation discovery + column validation; degrade to `unobservable` with reason, never zero (R-002) |
| Rollout tail misses a marker and reports a busy task as idle | Two-step escalation then explicit `indeterminate`; never silently inactive (R-003) |
| Subagent naming leaks into the UI | Shape-only classification to a closed set; assert no raw `source` value reaches the snapshot (R-004) |
| Reproducing the indicator's broken caffeinate check | Corrected detection; divergence stated in the parity record rather than treated as a failure (R-005) |
| Indicator removed before parity is proven, leaving no signal | FR-022 keeps removal a separate authorized step gated on recorded evidence (A-009) |
| Reading another application's live database disrupts it | `readOnly` + `query_only` + `busy_timeout=50`; yields rather than blocks (R-001) |

## Complexity Tracking

> Not required — Constitution Check reported no violations.
