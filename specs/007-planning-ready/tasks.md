# Tasks
- [x] T001 Record approved contract in specs/007-planning-ready/.
- [x] T002 [US1] Add failing regression tests and six-stage planning behavior in tools/agent-desk/server/{workflow,service,runner,task-packet}.mjs and tests/*.test.mjs.
- [x] T003 [US2] Implement readiness, confirmed admission and explicit launch queue in tools/agent-desk/server/** and bin/**; API/runner tests.
- [x] T004 [US3] Enforce conflict checks and reservation snapshots across write/claim/sync paths in tools/agent-desk/server/**; test races and stale state in tests/*.test.mjs.
- [x] T005 [P] [US2] Add brief fields and shared stage/owner confirmation in tools/agent-desk/src/**; typecheck/build.
- [x] T006 [US1] Add and run isolated Planning/Ready journeys in tools/agent-desk/tests/planning-ready.spec.ts and update existing browser fixtures.
- [x] T007 Update AGENTS.md, docs/AGENT_DESK_POLICY.md, tools/agent-desk/README.md; full tests/review/PR evidence in specs/007-planning-ready/verification.md.

Dependencies: T001 precedes backend T002–T004 and independent UI T005 against locked contract. T006 integrates both; T007 follows. One backend writer and one UI writer; independent review after implementation.
