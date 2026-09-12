# Tasks: Agent Desk desktop and intake

## Foundation
- [x] T001 Lock spec, research, contracts and diagnostic evidence in specs/004-agent-desk-usability/** and .specify/feature.json; claim AGENT-3.
- [x] T002 Add shared intake types and pinned parser dependencies in tools/agent-desk/src/intake-types.ts, src/types.ts, package.json and package-lock.json. Lead only; npm dependency validation.

## US1 — Chrome app and readability
- [x] T003 [P] [US1] Reproduce clipping/typography in tests/intake-browser.spec.ts; fix styles.css and components/WorkView.tsx with full identifiers and +3px. Frontend owns all UI styles; browser width assertions before/after.
- [x] T004 [P] [US1] Implement public/manifest.webmanifest, public/icons/*, public/sw.js, public/offline.html, index.html, src/pwa.ts, src/main.tsx, src/components/InstallAppButton.tsx and tests/pwa.test.mjs. PWA worker; static asset/security assertions and install metadata; lead HTTP MIME support.

## US2 — Document intake
- [x] T005 [P] [US2] Write parser RED tests/synthetic fixtures then document-processor.mjs/document-worker.mjs under server, tests/document-processor.test.mjs and tests/fixtures/documents/*. Parser owner; focused Node suite.
- [x] T006 [US2] Add authenticated attachment store/routes and atomic binding in server/attachments.mjs, server/http.mjs, server/service.mjs; tests/intake-http.test.mjs and tests/attachments.test.mjs. Lead; limits/access/expiry/restart/rollback.
- [x] T007 [US2] Implement file drop/process/preview/removal/create and detail/download UI in components/CreateDialogs.tsx, TicketDetails.tsx, DocumentAttachments.tsx, src/intake.ts and tests/intake-browser.spec.ts. Frontend; contract locked before parallel work; execute integrated tests after T006.

## US3 — Existing repository folders
- [x] T008 [P] [US3] Implement server/project-folders.mjs and tests/project-folders.test.mjs; wire HTTP inspect/browse/pick/create dedup in server/http.mjs. Lead; fixture repositories and injected picker.
- [x] T009 [US3] Add folder picker/navigation/inspection in components/CreateDialogs.tsx, FolderPicker.tsx and tests/intake-browser.spec.ts. Frontend; no repo mutations; execute after T008.

## US4 — Agent work packets
- [x] T010 [US4] Persist optional brief fields and owned detail context in server/service.mjs; build bounded trusted/untrusted packet in server/task-packet.mjs; wire server/runner.mjs and bin/mcp.mjs; tests/task-packet.test.mjs and existing core/mcp/runner tests. Lead.
- [x] T011 [US4] Add brief form, recorded/missing evidence checklist and copy packet in CreateDialogs.tsx, TicketDetails.tsx and WorkflowBrief.tsx; frontend. Preserve existing guards and honest evidence semantics.

## Integration and delivery
- [x] T012 Integrate UI install button in App.tsx (frontend), all new browser tests via playwright.config.ts and deterministic tests/serve-e2e.mjs (lead); full npm test/build/test:e2e. Fix reviewed gaps only within named feature scope.
- [ ] T013 Independent review of source/auth/limits/packets/PWA and browser/native proof; record specs/004-agent-desk-usability/verification.md, update tools/agent-desk/README.md, docs/AGENT_DESK_POLICY.md and docs/PROJECT_DEVELOPMENT.md.
- [ ] T014 Commit/push/PR, green CI and review, merge and ff main; preview/backup/redeploy app with existing bin/install.mjs, install Chrome app through Chrome UI, verify exact live root/SHA/claims and owned-ticket delivery. Record evidence and rollback paths.

Dependencies: T001→T002. Parser T005 and PWA T004 are independent after contracts; frontend T003/T007/T009/T011 follows frozen shared types and runs alongside lead backend work. Lead serializes all shared service/http/lockfile changes. Final T012→T013→T014. MVP slices stay checkpointed; all four stories are required for user completion.

Delivery checkpoint (2026-09-13): T002–T012 passed; 175 Node tests, 34 browser tests,
build, independent source review and all three CI jobs green. PR17 merged and the exact
runtime is deployed with backup/rollback and claim preservation verified. T013/T014 remain
open only for completing the native folder chooser and Chrome standalone installation:
macOS is locked and the unlock request is pending. See verification.md for exact evidence.
