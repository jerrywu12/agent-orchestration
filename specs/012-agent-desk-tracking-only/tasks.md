# Tasks: Agent Desk Tracking Only

**Input**: [spec.md](spec.md), [plan.md](plan.md)
**Verification**: `npm test`, `npm run build`, `npm run test:e2e` in `tools/agent-desk`.

## User Story 1: Assign without launch

- [x] T001 [US1] Change transition and legacy intent handling in `tools/agent-desk/server/service.mjs`.
- [x] T002 [US1] Change Planning/Ready and bulk confirmation UI in `tools/agent-desk/src/components/StageTransition.tsx`, `BulkPlanningTransition.tsx` and `App.tsx`.
- [x] T003 [US1] Cover single and bulk moves in `tools/agent-desk/tests/tracking-only.test.mjs`, `planning-ready.spec.ts` and `bulk-planning.spec.ts`.

## User Story 2: Independently reported progress

- [x] T004 [US2] Preserve claim/event stage transitions and show unclaimed versus reporting states in `tools/agent-desk/server/service.mjs` and `src/components/PlanningProgress.tsx`.
- [x] T005 [US2] Update guidance in `docs/AGENT_DESK_POLICY.md`, `tools/agent-desk/README.md`, `bin/install.mjs` and task brief UI.
- [x] T006 [US2] Verify exact-session reporting in `tools/agent-desk/tests/tracking-only.test.mjs` and `browser.spec.ts`.

## User Story 3: Retire launch requests

- [x] T007 [US3] Reject new starts in `tools/agent-desk/server/runner.mjs` and `run-coordinator.mjs`; remove Run Agent controls from `src/components/WorkView.tsx`.
- [x] T008 [US3] Replace obsolete launch tests while preserving recovery checks in `tools/agent-desk/tests/`.
- [ ] T009 [US3] Run full checks, review diff, commit and create PR; merge after required review and CI.

## Dependencies

T001–T003 establish passive transitions; T004–T006 verify reporting; T007–T009 close launch entry points and delivery gates.
