# Tasks: Ticket Effort

## Setup
- [x] T001 Lock spec/design/contracts and checklist in `specs/009-ticket-effort/**` and set `.specify/feature.json`.

## US1 - Estimate effort
- [x] T002 [US1] Add failing persistence/validation/session/metadata tests in `tools/agent-desk/tests/effort.test.mjs`, API tests in `tests/http.test.mjs`, MCP tests in `tests/mcp.test.mjs`, sync preservation in `tests/sync.test.mjs`.
- [x] T003 [US1] Implement validation, defaults, public legacy read normalization and authorized mutations in `tools/agent-desk/server/service.mjs` and `bin/mcp.mjs`; run focused Node tests and commit.
- [x] T004 [US1] Add failing create/edit/clear/reload DOM journey to `tools/agent-desk/tests/browser.spec.ts`.
- [x] T005 [US1] Add `tools/agent-desk/src/effort.ts`, `src/components/EffortSelect.tsx` and update `src/types.ts`, `src/components/CreateDialogs.tsx`, `TicketDetails.tsx`; verify DOM journey.

## US2 - Compare backlog
- [x] T006 [US2] Add failing list/card/filter/order DOM checks to `tools/agent-desk/tests/browser.spec.ts`.
- [x] T007 [US2] Implement Effort column/card, edit, filter and stable sorting in `tools/agent-desk/src/components/WorkView.tsx`, `src/styles.css`, and shared `src/effort.ts`; run DOM checks and commit.

## US3 - Sort work attributes (authorized scope revision)
- [x] T009 [US3] Add failing sort-direction, missing-value and clear-sort DOM tests to `tools/agent-desk/tests/browser.spec.ts`.
- [x] T010 [US3] Implement semantic sorting in `tools/agent-desk/src/ticket-sort.ts` and `src/components/WorkView.tsx`; verify both directions and clear behavior with preserved grouping/selection.

## Verification
- [ ] T008 Document field contract in `tools/agent-desk/README.md`; run all `npm test`, `npm run build`, `npm run test:e2e`; review raw diff and write evidence in `specs/009-ticket-effort/verification.md`; commit.

## Dependencies and Strategy
T001 → T002 → T003 → T004 → T005 → T006 → T007 → T009 → T010 → T008. Deliver API persistence first, then editing, then comparison. Shared schema and WorkView require one writer; no parallel implementation. Independent lead audit/release follows this bounded implementation. Every story has its independent acceptance journey in spec.md. All source files are under tools/agent-desk; no live state access.
