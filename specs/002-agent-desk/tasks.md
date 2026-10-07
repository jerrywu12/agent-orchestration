# Tasks: Agent Desk
## Setup and core
- [x] T001 Define spec/plan/data model/API in specs/002-agent-desk/.
- [x] T002 Write failing core ownership/persistence/dependency tests in tools/agent-desk/tests/core.test.mjs.
- [x] T003 Implement store and service in tools/agent-desk/server/{store,service}.mjs.
- [x] T004 Implement API/auth/execution in tools/agent-desk/server/{http,runner}.mjs with tests.
## US1 list management
- [x] T005 [P] [US1] Build frontend in tools/agent-desk/src/ and index.html against locked API.
- [x] T006 [US1] Verify browser creation/edit/filter/stages/persistence via tools/agent-desk/tests/browser.spec.ts.
## US2 independent agents
- [x] T007 [US2] Implement CLI and stdio MCP in tools/agent-desk/bin/ with connector tests.
- [x] T008 [US2] Integrate external runner hooks in scripts/agent_workflow.sh and scripts/codex_auto_dev.sh.
## US3 GitHub
- [x] T009 [P] [US3] Implement injected-transport GitHub sync in tools/agent-desk/server/github.mjs and tests/github.test.mjs.
- [x] T010 [US3] Connect sync jobs/API and verify live existing repository/Project mapping.
## US4 replacement
- [x] T011 [US4] Implement read-only idempotent import in tools/agent-desk/server/migrate.mjs and tests/migrate.test.mjs.
- [x] T012 [US4] Implement preview/backup/cutover/rollback installer in tools/agent-desk/bin/ and replace board policy/templates.
- [x] T013 [US4] Import actual source and verify counts, active claims and legacy-writer retirement.
## US5 hosting and release
- [x] T014 [US5] Add Dockerfile/compose/service/backup docs in tools/agent-desk/.
- [x] T015 [US5] Run app and repository gates, installer smoke, independent review; commit/push/PR.
- [x] T016 [US5] Deploy authorized replacement, verify live source identity/browser/connectors; record evidence in specs/002-agent-desk/verification.md.

- [x] T017 Transition observer under [explicit transition contract](transition-contract.md), preserving native sessions during cutover.

## Metadata-only scope release amendment 2026-10-08
- [x] T018 Lock reviewed spec/plan/API amendment and exact owned scope before source changes.
- [x] T019 Write and run genuine failing own-checkpoint API/MCP/CLI regression and negative tests in tools/agent-desk/tests/{scope_release,mcp}.test.mjs.
- [x] T020 Implement fixed atomic source-only release in server/{service,http}.mjs and bin/{desk,mcp}.mjs; preserve general grants and ownership guards.
- [x] T021 Update canonical policy/API/README; run focused then complete npm test/build/e2e.
- [ ] T022 Independent exact-head review, push/PR, green CI, squash merge; installed identity/API proof with preserved active sessions; record verification.
