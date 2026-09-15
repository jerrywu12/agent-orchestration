# Tasks: Background AI agent activity tracking

**Input**: Design documents from `specs/011-agent-activity-tracking/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/activity-api.md](./contracts/activity-api.md), [quickstart.md](./quickstart.md)

**Tests**: Included. `AGENTS.md` requires reproducing the relevant failure before fixing it and proving the changed boundary afterward, and the spec's success criteria are stated as assertions. Test tasks are therefore mandatory, not optional, for this feature.

**Organization**: Grouped by user story. Phases map to plan.md's Phase A–E as noted per phase.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 from spec.md
- All paths are repository-relative from `/Users/jerry/agent-orchestrator/.claude/worktrees/prevent-llm-cheating-067d57`

## Scope boundary (docs/SPEC_KIT_POLICY.md)

Each task names its files and its verification command. **Editing a file not named by the current task is scope creep — stop and surface it instead of fixing along the way.** Commit before each task; two failed fix attempts on the same error means revert and re-plan rather than a third patch.

**Never touched by this feature**: `server/service.mjs`, `server/store.mjs`, `server/sync.mjs`, `server/migrate.mjs`, `server/runner.mjs`, `server/run-coordinator.mjs`, `server/agent-status.mjs`, `server/machine-inventory.mjs`, `server/machine-monitor.mjs`, `server/legacy-observer.mjs`. The last three are **read for reference only** — copy their patterns, do not modify them.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Fixtures and scaffolding. No production behaviour yet.

- [ ] T001 Verify the environment matches the research measurements by running quickstart.md §1 (the `node -e` probe and the `etimes` check); if `tailMissed` is not a small minority of `candidates`, or `etimes` now resolves, STOP and revise [research.md](./research.md) R-003/R-006 before writing code. Verify: `node -v` reports ≥ v22.22.0 and both probes in [quickstart.md](./quickstart.md) §1 print expected values.
- [ ] T002 [P] Create the fixture directory `tools/agent-desk/tests/fixtures/activity/` with a builder module `tools/agent-desk/tests/fixtures/activity/build.mjs` that constructs a throwaway SQLite database with a `threads` table matching the live column set, writes synthetic rollout files, and returns synthetic `ps` output strings. Fixtures must be generated into a temp dir at test time and **must never read `~/.codex` or the real process table**. Verify: `cd tools/agent-desk && node tests/fixtures/activity/build.mjs` exits 0 and creates no file outside its temp dir.
- [ ] T003 [P] Add `tools/agent-desk/src/activity-types.ts` declaring `ActivitySnapshot`, `ActiveTask`, `ActiveWorker`, `SleepPrevention`, `SleepHolder` and `SourceObservability` exactly per [data-model.md](./data-model.md), styled after `src/machine-types.ts`. Verify: `cd tools/agent-desk && npx tsc --noEmit`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The module skeleton and shared helpers every story depends on. **Blocks all user stories.**

*Plan Phase A.*

- [ ] T004 Create `tools/agent-desk/server/agent-activity.mjs` exporting the frozen `ACTIVITY_LIMITS` bounds table from [data-model.md](./data-model.md) ("Bounds summary"), the closed `REASONS` wording map, and stubs for `collectActivity()` and `class AgentActivityMonitor`. No logic yet. Verify: `cd tools/agent-desk && node -e 'import("./server/agent-activity.mjs").then(m=>console.log(Object.keys(m)))'` lists all exports.
- [ ] T005 Create `tools/agent-desk/tests/agent-activity.test.mjs` with the suite skeleton and one failing assertion per [quickstart.md](./quickstart.md) §2 coverage row. Verify: `cd tools/agent-desk && node --test tests/agent-activity.test.mjs` runs and **fails** — this is the required red state before implementation.
- [ ] T006 [P] Implement `parseElapsedSeconds()` in `tools/agent-desk/server/agent-activity.mjs` handling `MM:SS`, `HH:MM:SS`, `DD-HH:MM:SS`, leading-padded and malformed input, returning integer seconds or `null` (R-006). Verify: `cd tools/agent-desk && node --test tests/agent-activity.test.mjs` — elapsed-parsing cases pass.
- [ ] T007 [P] Implement `normalizeDescription()` and `workspaceSegment()` in `tools/agent-desk/server/agent-activity.mjs`: strip tabs/newlines/CR/control chars, cap at 60, empty → `"Untitled task"`; workspace reduced to final path segment, empty → `"—"` (FR-019). Verify: `cd tools/agent-desk && node --test tests/agent-activity.test.mjs` — normalization cases pass, including an assertion that no emitted `workspace` contains `/`.

**Checkpoint**: Helpers are green. User stories may begin.

---

## Phase 3: User Story 1 — See what agent work is in flight right now (Priority: P1) 🎯 MVP

**Goal**: The administrator sees an active count and the breakdown of active Codex tasks and active workers.

**Independent test**: Seed a fixture activity source with working / finished / never-started records plus a fixture process list; assert the count and every row field. Delivers full value with no dependency on US2.

*Plan Phases A–C.*

### Tests for US1

- [ ] T008 [P] [US1] Add lifecycle-detection cases to `tools/agent-desk/tests/agent-activity.test.mjs`: last marker `started` → active; last `complete` → excluded; never emitted → excluded; beyond the escalation bound → `indeterminate` and `partial: true` (FR-003, acceptance 1.1–1.3). Verify: `cd tools/agent-desk && node --test tests/agent-activity.test.mjs` — these fail before T012.
- [ ] T009 [P] [US1] Add origin-classification cases to `tools/agent-desk/tests/agent-activity.test.mjs` covering `vscode`, `exec`, `cli`, structured subagent JSON, and an unknown value — **including an assertion that no raw `source` value, `agent_path`, `agent_nickname` or `parent_thread_id` appears anywhere in the snapshot** (FR-005, R-004). Verify: `cd tools/agent-desk && node --test tests/agent-activity.test.mjs` — these fail before T013.
- [ ] T010 [P] [US1] Add one named worker-exclusion case per rule in [data-model.md](./data-model.md) ActiveWorker — desktop bundle, IDE extensions dir, language-server helper, observer's own process, Codex-counted-as-tasks — to `tools/agent-desk/tests/agent-activity.test.mjs` (SC-003, R-007). Verify: `cd tools/agent-desk && node --test tests/agent-activity.test.mjs` — these fail before T014.
- [ ] T011 [P] [US1] Add degradation and invariant cases to `tools/agent-desk/tests/agent-activity.test.mjs`: missing source, failed column validation, unreadable DB, `ps` failure, non-darwin platform → correct closed-set `reason`, `retained` prior values, and **`state` never `idle` when any source is unobservable** (FR-011, SC-005). Verify: `cd tools/agent-desk && node --test tests/agent-activity.test.mjs` — these fail before T016.

### Implementation for US1

- [ ] T012 [US1] Implement source discovery, hardened read and lifecycle scan in `tools/agent-desk/server/agent-activity.mjs`: enumerate `state_<N>.sqlite` and select the highest `N`; validate `threads` columns via `PRAGMA table_xinfo`; open `readOnly` with `query_only=ON`, `trusted_schema=OFF`, `busy_timeout=50`; apply the `realpathSync`/`lstatSync`/WAL-sidecar checks copied from `server/legacy-observer.mjs` `openSource()`; prefilter `archived = 0 AND updated_at >= now - 86400`; then scan each rollout tail 256 KiB → 4 MiB for the last `task_(started|complete)` marker, classifying an unresolved thread `indeterminate` (R-001, R-002, R-003). Raw rollout bytes must not be retained past the scan. Verify: `cd tools/agent-desk && node --test tests/agent-activity.test.mjs` — T008 cases pass.
- [ ] T013 [US1] Implement `classifyOrigin()` in `tools/agent-desk/server/agent-activity.mjs` mapping to the closed set by shape detection only, and wire task assembly (short 8-char id, origin, normalized description, workspace segment, lifecycle) (FR-004, FR-005, R-004). Verify: `cd tools/agent-desk && node --test tests/agent-activity.test.mjs` — T009 cases pass.
- [ ] T014 [US1] Implement the process collector in `tools/agent-desk/server/agent-activity.mjs`: run `/bin/ps -axo pid=,ppid=,etime=,command=` bounded to 2 MiB / 10 000 rows, match workers using a scoring approach modelled on `server/machine-inventory.mjs` `processMatch()`, apply all five exclusions, and **discard every command string at the classification boundary** so no argument reaches the snapshot (FR-006, FR-007, FR-019, R-006, R-007). Verify: `cd tools/agent-desk && node --test tests/agent-activity.test.mjs` — T010 cases pass.
- [ ] T015 [US1] Implement `collectActivity()` assembly in `tools/agent-desk/server/agent-activity.mjs`: compute `activeCount` as active tasks + active non-Codex workers, derive `state` per the data-model invariants, apply the Codex-process fallback when the task source is unobservable, and populate `sources`, `partial`, `truncated` and `notes` from the closed wording set (FR-002, FR-009, R-010). Verify: `cd tools/agent-desk && node --test tests/agent-activity.test.mjs` — invariant cases pass.
- [ ] T016 [US1] Implement `AgentActivityMonitor` in `tools/agent-desk/server/agent-activity.mjs` mirroring `server/machine-monitor.mjs`'s contract: constructor-injected collectors, `snapshot()`, coalescing `refresh()`, retained-stale-on-failure with fixed wording, `AbortController` bounded to an 8 s collector timeout, `unref()`ed 15 s timer, and `close()` aborting in-flight work (FR-012, FR-013, FR-014). Verify: `cd tools/agent-desk && node --test tests/agent-activity.test.mjs` — full suite passes, including T011.
- [ ] T017 [US1] Add `GET /api/activity` and `POST /api/activity/refresh` to `tools/agent-desk/server/http.mjs`, following the existing `resource === "machine"` block: `503 ACTIVITY_UNAVAILABLE` when unconstructed, `404 NOT_FOUND` for unknown activity paths, `202` + snapshot on refresh. Construct the monitor alongside `machineMonitor` in `startServer()` and close it in the shutdown path. Do **not** add authorization code — `activity` is absent from the agent allowlist and is denied by default (R-009). Verify: `cd tools/agent-desk && node --test tests/http.test.mjs`.
- [ ] T018 [US1] Create `tools/agent-desk/tests/activity-http.test.mjs` asserting the seven contract guarantees in [contracts/activity-api.md](./contracts/activity-api.md) — notably guarantee 1 as a **structural sweep over the whole payload** for absolute paths, command lines and full thread ids, and guarantee 7's `403 AGENT_SCOPE` for an agent-role token on both routes (FR-020, SC-009). Verify: `cd tools/agent-desk && node --test tests/activity-http.test.mjs`.
- [ ] T019 [US1] Create `tools/agent-desk/src/components/AgentActivity.tsx` rendering count, state, task rows and worker rows from `src/activity-types.ts`, with the three states **structurally distinguishable in the DOM** (active / none active / cannot observe) plus stale and partial indicators. Fetch via the existing client pattern in `src/api.ts`. Verify: `cd tools/agent-desk && npx tsc --noEmit`.
- [ ] T020 [US1] Render `AgentActivity` as a new section in `tools/agent-desk/src/components/MachineView.tsx` and add its styles to `tools/agent-desk/src/styles.css`, matching existing section conventions. Do not alter existing MachineView sections. Verify: `cd tools/agent-desk && npm run build`.
- [ ] T021 [US1] Create `tools/agent-desk/tests/activity-browser.spec.ts` covering the three states, the stale indicator and the partial-coverage indicator, asserting on distinct DOM structure rather than text alone (SC-005). Verify: `cd tools/agent-desk && npx playwright test tests/activity-browser.spec.ts`.

**Checkpoint**: US1 is independently shippable. `npm test`, `npm run build` and `npm run test:e2e` are green; [quickstart.md](./quickstart.md) §3 returns a valid snapshot and the privacy grep prints `PASS`.

---

## Phase 4: User Story 2 — Know whether the Mac is being held awake (Priority: P2)

**Goal**: Sleep-prevention state and its holders are visible.

**Independent test**: Fixture process lists with and without an agent-linked hold; assert state and holders. Runs with no task source present.

*Plan Phase D. This corrects a defect rather than porting logic — see R-005.*

- [ ] T022 [P] [US2] Add sleep-prevention cases to `tools/agent-desk/tests/agent-activity.test.mjs`: agent-linked hold → `active` with holders; no hold → `inactive`; **a non-agent-linked hold → not reported** (acceptance 2.1–2.3); and a regression case for the wrapper-script shape observed on this Mac, which the superseded indicator's hardcoded pattern misses (R-005). Verify: `cd tools/agent-desk && node --test tests/agent-activity.test.mjs` — these fail before T023.
- [ ] T023 [US2] Implement sleep-prevention detection in `tools/agent-desk/server/agent-activity.mjs`: find `caffeinate` holders in the already-collected process list and classify agent-linked by recognized wrapper or by `ppid` ancestry reaching a tracked agent. **Do not match a hardcoded absolute binary path** (FR-008, R-005). Verify: `cd tools/agent-desk && node --test tests/agent-activity.test.mjs` — T022 cases pass.
- [ ] T024 [US2] Render sleep-prevention state and holders in `tools/agent-desk/src/components/AgentActivity.tsx`, and extend `tools/agent-desk/tests/activity-browser.spec.ts` with active/inactive DOM cases. Verify: `cd tools/agent-desk && npm run build && npx playwright test tests/activity-browser.spec.ts`.

**Checkpoint**: US1 + US2 complete. Feature is functionally whole.

---

## Phase 5: User Story 3 — Retire the menu bar indicator with evidence (Priority: P3)

**Goal**: Parity is recorded, then the indicator is removed as a separate authorized step.

**Independent test**: Capture both signals at one moment and compare the active sets.

*Plan Phase E. Depends on US1 and US2.*

- [ ] T025 [US3] Run the parity capture in [quickstart.md](./quickstart.md) §7 on the target Mac while real agent work is in flight, and record the comparison as `specs/011-agent-activity-tracking/parity-evidence.md` — task set, worker set, sleep-prevention state, timestamps, and the **expected sleep-prevention divergence from R-005 stated as a corrected defect, not a parity failure** (SC-010, FR-021). Verify: `parity-evidence.md` exists and its task and worker sets match; any unexplained difference blocks T027.
- [ ] T026 [US3] Open the PR for this change with scope, acceptance coverage and the actual check output, per `AGENTS.md`. Merge only after required checks and review pass, then fast-forward the clean canonical checkout. Verify: PR checks green and merged.
- [ ] T027 [US3] **Machine-local, separately authorized — requires explicit confirmation at the time; not implied by merging T026.** Back up `/Users/jerry/.swiftbar/codex-status.5s.sh` to `/Users/jerry/.swiftbar-retired-codex-status.5s.sh.bak`, quit SwiftBar, remove the plugin file, and remove SwiftBar's login item per [quickstart.md](./quickstart.md) §8. Preserve `~/.swiftbar` itself and SwiftBar preferences (`PluginDirectory` points there). Verify: Agent Desk still reports activity after removal, and restoring the `.bak` plus relaunching SwiftBar recovers the prior state (FR-022).

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T028 [P] Confirm the no-persistence guarantee per [quickstart.md](./quickstart.md) §6 — exercise refreshes, restart the test instance, and grep its store for a task description seen in the API response (FR-018, SC-008). Verify: grep finds no match.
- [ ] T029 [P] Run the full regression — `cd tools/agent-desk && npm test && npm run build && npm run test:e2e` — confirming every pre-existing suite stays green (SC-011). Verify: all three commands exit 0.
- [ ] T030 Update `tools/agent-desk/README.md` with a short Activity section describing what is observed, the read-only guarantee and the degradation states. Documentation only; no behaviour change. Verify: `cd /Users/jerry/agent-orchestrator/.claude/worktrees/prevent-llm-cheating-067d57 && git diff --stat tools/agent-desk/README.md` shows only that file.

---

## Dependencies & Execution Order

```text
Phase 1 Setup (T001–T003)
        │
Phase 2 Foundational (T004–T007)   ← BLOCKS everything below
        │
        ├─▶ Phase 3  US1 (T008–T021)  🎯 MVP — independently shippable
        │            │
        │            └─▶ Phase 4  US2 (T022–T024)   [needs US1's process collector]
        │                        │
        │                        └─▶ Phase 5  US3 (T025–T027)  [needs US1 + US2]
        │
        └─▶ Phase 6  Polish (T028–T030)  [after US1 at minimum]
```

**Story independence**: US1 stands alone and is the MVP. US2 reuses US1's process collector, so it follows rather than parallels. US3 is a verification-and-decommission gate and requires both.

**Hard ordering within US1**: T012 → T013 → T014 → T015 → T016 (same file, sequential) → T017 → T018; T019 → T020 → T021.

## Parallel Opportunities

- **Phase 1**: T002 and T003 together (different files).
- **Phase 2**: T006 and T007 together — both add independent pure helpers; land T004 and T005 first.
- **US1 tests**: T008, T009, T010 and T011 all together — they add independent cases to one test file, so either coordinate edits or land them sequentially if the agent cannot merge cleanly.
- **US1 client**: T019 can proceed in parallel with T017/T018 once `src/activity-types.ts` (T003) exists.
- **Phase 6**: T028, T029 and T030 together.

## Implementation Strategy

**MVP = Phase 1 + Phase 2 + Phase 3 (US1).** That delivers the count and the breakdown — the whole reason the indicator exists — and is independently shippable.

**Increment 2**: US2 completes functional parity and fixes the sleep-prevention defect.

**Increment 3**: US3 records parity and retires the indicator. **T027 does not follow automatically from a merged PR** — it is a machine-local operation requiring explicit authorization at the time, per `AGENTS.md`.

## Task Summary

| Phase | Tasks | Count |
|---|---|---|
| 1 — Setup | T001–T003 | 3 |
| 2 — Foundational | T004–T007 | 4 |
| 3 — US1 (P1, MVP) | T008–T021 | 14 |
| 4 — US2 (P2) | T022–T024 | 3 |
| 5 — US3 (P3) | T025–T027 | 3 |
| 6 — Polish | T028–T030 | 3 |
| **Total** | | **30** |

Parallel-marked tasks: 12. Test tasks: 9 (T005, T008–T011, T018, T021, T022, plus T029's regression sweep).
