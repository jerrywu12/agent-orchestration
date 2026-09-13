# Tasks: Bulk Backlog to Planning

## Phase 1: Setup

- [x] T001 Lock scope and acceptance in `specs/008-bulk-planning/spec.md`, plan/design artifacts, `.specify/feature.json`; exact AGENT-13 claim.

## Phase 2: Foundation

- [ ] T002 Write/run RED tests in `tools/agent-desk/tests/bulk-planning.spec.ts`; register in `tools/agent-desk/playwright.config.ts`.

## Phase 3: US1 — Drop, preview, confirm (MVP)

Independent proof: two selected tickets, list/board drop opens one modal; cancel zero writes; confirm own-project Planning API requests.

- [ ] T003 [P] [US1] Implement native drag/target/count and modal wiring in `tools/agent-desk/src/components/WorkView.tsx`, pass integrations in `tools/agent-desk/src/App.tsx`, reuse tokens in `tools/agent-desk/src/styles.css`.
- [ ] T004 [P] [US1] Implement snapshot/owner/per-ticket confirmation in `tools/agent-desk/src/components/BulkPlanningTransition.tsx`.
- [ ] T005 [US1] Run focused DOM/build and record RED/GREEN in `specs/008-bulk-planning/verification.md`.

## Phase 4: US2 — Safety and accessibility

Independent proof: button/keyboard, held/mixed/stale, partial failure/uncertainty and duplicate click all retain truthful outcomes.

- [ ] T006 [US2] Complete exclusions, sequential rechecks, one-shot lock, refresh isolation and results in `tools/agent-desk/src/components/BulkPlanningTransition.tsx`; keyboard equivalent in `tools/agent-desk/src/components/WorkView.tsx`.
- [ ] T007 [US2] Complete safety/edge/regression matrix in `tools/agent-desk/tests/bulk-planning.spec.ts`; run full Node/DOM/build.

## Phase 5: Delivery

- [ ] T008 Independent exact-head review, CI, PR/merge and safe live verification in `specs/008-bulk-planning/verification.md`; update canonical AGENT-13 with evidence.

## Dependencies and parallel execution

T001→T002 RED→T003+T004 (separate files and locked props)→T005→T006→T007→T008. Tests may expand in parallel with implementation after baseline RED; reviewers read only. US2 must pass before release; no incomplete MVP cutover. Seven remaining tasks: US1 three, US2 two, foundation one, delivery one. All tasks have IDs/paths and tests are mandatory by spec.
