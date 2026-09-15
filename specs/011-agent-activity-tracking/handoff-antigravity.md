# Implementation handoff — Antigravity

**Feature**: `specs/011-agent-activity-tracking` | **Date**: 2026-09-15 | **Assigned by**: Jerry, explicitly, this session

**Executor**: Antigravity (`agy` 1.2.2, `/Users/jerry/.local/bin/agy`) — replacing the usual Codex implementation lane for this feature.

Per `GEMINI.md`, Antigravity's default role is targeted review *or independent work explicitly assigned by the user*. This is that explicit assignment. Per `AGENTS.md`, Codex normally owns implementation "unless the user assigns work differently" — he has.

---

## 1. Objective

Implement background AI agent activity tracking in Agent Desk so the administrator can see, from the app, what AI agent work is in flight on this Mac — active Codex tasks, active Claude/Gemini/Antigravity workers with elapsed runtime, and agent-linked sleep-prevention state. This supersedes the SwiftBar `codex-status.5s.sh` menu bar plugin.

**Scope for this handoff**: tasks **T001–T024** (Phases 1–4 = Setup, Foundational, US1, US2).

**Explicitly NOT in this handoff**:
- **T025** (parity capture) — run only after T001–T024 are green.
- **T026** (PR merge) — Jerry's call.
- **T027** (removing the SwiftBar plugin) — a machine-local operation requiring Jerry's explicit authorization at the time. **Do not perform it.** It does not follow from merging anything.

## 2. Exact checkout

| | |
|---|---|
| Repository | `jerrywu12/agent-orchestration` |
| Worktree | `/Users/jerry/agent-orchestrator/.claude/worktrees/prevent-llm-cheating-067d57` |
| Branch | `claude/ai-agent-activity-tracking-47d573` |
| Spec commit | `dcc33ad44991272912b8dc90fab35e968ae5f576` |
| Base | `origin/main` at `2e41e85` |
| Spec PR | [#42](https://github.com/jerrywu12/agent-orchestration/pull/42) — specification only, no source changes |

**Branching — confirm with Jerry before starting.** Preferred: let PR #42 merge on its own merit (it is spec-only and independently reviewable — separating spec review from implementation review is the point of the Spec Kit workflow), then start from a fresh worktree off updated `main`, per `AGENTS.md`. Fallback if #42 has not merged: branch from `dcc33ad` so the spec is present, and keep implementation commits distinct from the spec commit.

## 3. Read first, in this order

1. `GEMINI.md` — your role and board-sync obligations in this repo.
2. `AGENTS.md` — verification rules, ownership, machine-local boundaries.
3. `specs/011-agent-activity-tracking/spec.md` — 3 user stories, 22 FRs, 11 SCs.
4. `specs/011-agent-activity-tracking/research.md` — **R-001…R-010. Read this properly.** Every number in it was measured on this Mac, and two findings mean this is *not* a port of the shell script.
5. `specs/011-agent-activity-tracking/plan.md` — architecture and Phase A–E mapping.
6. `specs/011-agent-activity-tracking/data-model.md` — entities, invariants, bounds.
7. `specs/011-agent-activity-tracking/contracts/activity-api.md` — the API contract and its 7 testable guarantees.
8. `specs/011-agent-activity-tracking/tasks.md` — **your task list. Work it in order.**
9. `specs/011-agent-activity-tracking/quickstart.md` — every verification command.

`.gemini/commands/speckit.implement.toml` is present in this repo, so `/speckit.implement` is available to you as a command surface if you prefer it to working `tasks.md` directly.

## 4. Observed vs expected behaviour

**Observed today**: `probeMachine` in `tools/agent-desk/server/machine-inventory.mjs:1073` runs `ps -axo pid=,pcpu=,rss=,comm=` and reports, per installed agent, `running`/`idle` plus CPU and RSS. That answers "is a binary resident in memory". It cannot distinguish an idle interactive session open for six hours from a subagent mid-task, and it has no task lifecycle, no elapsed runtime and no sleep-prevention signal. `server/agent-status.mjs` is unrelated — that is quota reporting.

**Expected after this work**: `GET /api/activity` returns the `ActivitySnapshot` in `contracts/activity-api.md`, rendered as a new section in the Machine view, with three structurally distinct states — active / none active / cannot observe.

## 5. Three things that will bite you

These are the findings that make this a correction rather than a port. Each is already encoded in `tasks.md`; this is why they are there.

**(a) The Codex `source` column is not an enum.** Measured over 7 days: structured JSON **169 (69%)**, `exec` 71, `vscode` 4, `cli` 1. The structured values are subagent spawn records carrying `parent_thread_id`, `agent_path` and `agent_nickname` — user-authored work naming such as `/root/phase_a_migration_w0_doubt`. FR-019 forbids surfacing those. Classify **by shape only**, into the closed set, and never let the raw value reach the snapshot. Because the structured form is the majority case, a classifier that falls through and stringifies would leak on most rows, not rarely. (R-004, T009, T013)

**(b) The shell script's sleep-prevention check is currently wrong — do not port it.** It matches the literal pattern `caffeinate -i /opt/homebrew/bin/codex`, which matches **zero processes** on this Mac, so it reports "inactive" while `caffeinate -is` (PID 2195) under `agent_caffeinate_watch.sh` has actually been holding the machine awake. Detect holds and classify agent-linkage by recognized wrapper or `ppid` ancestry. Expect Agent Desk to disagree with the script here — that disagreement is the fix, and T025 records it as such. (R-005, T022, T023)

**(c) A zero count must never be ambiguous.** `state: "idle"` is valid only when *every* source reports `observed`. Zero active items with an unobservable source yields `state: "unobservable"`. The dangerous failure is reporting "nothing is running" when the source simply could not be read — which is exactly what the script does when the database path changes. Related: do not hardcode `state_5.sqlite`; the `5` is a generation counter. Discover the highest `state_<N>.sqlite` and validate columns. (R-002, R-010, T011, T012, T015)

## 6. Owned paths

**You may create or edit only these:**

```text
tools/agent-desk/server/agent-activity.mjs        NEW
tools/agent-desk/server/http.mjs                  EDIT — /api/activity routes, construction, shutdown
tools/agent-desk/src/activity-types.ts            NEW
tools/agent-desk/src/components/AgentActivity.tsx NEW
tools/agent-desk/src/components/MachineView.tsx   EDIT — render the new section only
tools/agent-desk/src/styles.css                   EDIT — activity section styles only
tools/agent-desk/tests/agent-activity.test.mjs    NEW
tools/agent-desk/tests/activity-http.test.mjs     NEW
tools/agent-desk/tests/activity-browser.spec.ts   NEW
tools/agent-desk/tests/fixtures/activity/         NEW
tools/agent-desk/README.md                        EDIT — T030 only
```

**Read for reference, never modify** — copy their patterns:
- `server/machine-monitor.mjs` — the monitor lifecycle contract to mirror (coalescing, retained-stale, bounded abort, `unref()`ed timer, `close()`).
- `server/legacy-observer.mjs` `openSource()` — the read-only SQLite hardening to copy (realpath/lstat checks, WAL sidecar symlink rejection).
- `server/machine-inventory.mjs` `processMatch()` — the scoring model for process attribution.

**Never touched**: `server/service.mjs`, `store.mjs`, `sync.mjs`, `migrate.mjs`, `runner.mjs`, `run-coordinator.mjs`, `agent-status.mjs`, and the three reference files above.

Editing a file not named by the current task is scope creep — **stop and surface it** rather than fixing along the way (`docs/SPEC_KIT_POLICY.md`).

## 7. Constraints

- **No new dependencies.** Node 22 built-ins only (`node:sqlite`, `node:child_process`, `node:fs`) plus the existing React/TS stack. If you believe you need a dependency, stop and say so — do not add one.
- **No schema migration**, no change to any existing contract.
- **Strictly read-only** against the Codex database: `readOnly` + `query_only=ON` + `trusted_schema=OFF` + `busy_timeout=50`. Never create, migrate, repair or lock it. Never signal or kill an observed process.
- **Memory-only.** Activity never reaches the store, sync outbox, ticket history, logs or version control.
- **No secrets, prompts, transcripts, command arguments, environment values, absolute paths or full thread ids** in any output (FR-019).
- **Fixtures must never read the real `~/.codex` database or the real process table.** Inject collectors; generate fixtures into a temp dir.
- **Do not alter** tickets, stages, execution claims or agent capacity as a consequence of observing.

## 8. Acceptance commands

Run from `tools/agent-desk`:

```bash
npm test && npm run build && npm run test:e2e
```

Full verification detail is in `quickstart.md`. Two specifics that are easy to get wrong:

**Test instance must not use the default data dir** — it resolves to the installed app's live store at `~/.local/share/agent-desk` (`http.mjs:728`):

```bash
AGENT_DESK_PORT=7011 AGENT_DESK_DATA_DIR=/tmp/agent-desk-011 npm start &
```

**Privacy regression check** (contract guarantee 1, cheapest FR-019 check):

```bash
curl -s localhost:7011/api/activity | grep -E '/Users/|/opt/|/Applications/|--dangerously|sk-|Bearer ' && echo 'FAIL: forbidden content present' || echo 'PASS: no forbidden content'
```

Per `AGENTS.md`: Agent Desk verification uses code, scripts, API checks and automated DOM tests. **Do not use computer control and do not capture screenshots.**

Per `AGENTS.md`: reproduce the relevant failure before fixing it and prove the changed boundary afterward. **T005 requires a red test state before implementation** — that is deliberate, not a mistake.

## 9. Unresolved decisions — ask Jerry, don't guess

1. **Branch strategy** (§2) — merge PR #42 first and start from `main`, or branch from `dcc33ad`?
2. **US2 scope** — ship T001–T021 (US1, the MVP) as its own PR first, or deliver T001–T024 (US1 + US2) together?
3. If T001's environment probe disagrees with the measurements in `research.md` (tail-miss rate materially above 8.2%, or `etimes` now resolving on macOS), **stop**. That invalidates R-003 or R-006. Specs and locked plans are immutable during implementation — surface it and revise the plan rather than patching around it.

## 10. Return format

Report back with:

1. **Tasks completed**, by ID, and any not attempted with the reason.
2. **Actual command output** for `npm test`, `npm run build`, `npm run test:e2e` — real output, not a summary. A scaffold or a queue status is not implementation evidence (`GEMINI.md`).
3. **The privacy grep result** from §8.
4. **Files changed**, confirming nothing outside §6 was touched.
5. **Any scope creep you stopped on**, with what you found.
6. **Decisions you had to make** that the spec did not cover.
7. Explicit confirmation that **T025–T027 were not performed**.

Do not infer completion from a passing build alone; state what you inspected and what you ran. Integration and release decisions stay with Jerry.
