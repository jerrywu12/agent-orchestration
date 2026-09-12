# Tasks: Agent Desk
## Setup and core
- [x] T001 Define spec/plan/data model/API in specs/002-agent-desk/.
- [ ] T002 Write failing core ownership/persistence/dependency tests in tools/agent-desk/tests/core.test.mjs.
- [ ] T003 Implement store and service in tools/agent-desk/server/{store,service}.mjs.
- [ ] T004 Implement API/auth/execution in tools/agent-desk/server/{http,runner}.mjs with tests.
## US1 list management
- [ ] T005 [P] [US1] Build frontend in tools/agent-desk/src/ and index.html against locked API.
- [ ] T006 [US1] Verify browser creation/edit/filter/stages/persistence via tools/agent-desk/tests/browser.spec.ts.
## US2 independent agents
- [ ] T007 [US2] Implement CLI and stdio MCP in tools/agent-desk/bin/ with connector tests.
- [ ] T008 [US2] Integrate external runner hooks in scripts/agent_workflow.sh and scripts/codex_auto_dev.sh.
## US3 GitHub
- [ ] T009 [P] [US3] Implement injected-transport GitHub sync in tools/agent-desk/server/github.mjs and tests/github.test.mjs.
- [ ] T010 [US3] Connect sync jobs/API and verify live existing repository/Project mapping.
## US4 replacement
- [ ] T011 [US4] Implement read-only idempotent import in tools/agent-desk/server/migrate.mjs and tests/migrate.test.mjs.
- [ ] T012 [US4] Implement preview/backup/cutover/rollback installer in tools/agent-desk/bin/ and replace board policy/templates.
- [ ] T013 [US4] Import actual source and verify counts, active claims and legacy-writer retirement.
## US5 hosting and release
- [ ] T014 [US5] Add Dockerfile/compose/service/backup docs in tools/agent-desk/.
- [ ] T015 [US5] Run app and repository gates, installer smoke, independent review; commit/push/PR.
- [ ] T016 [US5] Deploy authorized replacement, verify live source identity/browser/connectors; record evidence in specs/002-agent-desk/verification.md.
