# Implementation Plan: Ticket Effort

Status: Locked for implementation. Branch: `codex/agent-desk-effort`.

## Summary and Technical Context
Extend Agent Desk's existing Node 22 SQLite JSON ticket records and React/TypeScript UI. No relational schema migration or new dependency is needed. The Service owns validation/defaults and existing HTTP/agent mutation guards. UI uses a shared effort selector/options module. Existing stage grouping stays intact; ordering applies within each group.

## Constitution Check
The repository constitution is an unfilled template; operative governance is AGENTS.md and PROJECT_DEVELOPMENT.md. One writer, isolated worktree, TDD, full source/DOM checks, independent lead review and separate deployment. No extension hooks configured. No conflicts or unresolved clarifications.

## Source Scope
- `tools/agent-desk/server/service.mjs`: nullable default, legacy read normalization, validation, editable field, change audit, exact-session agent update and subtask fields.
- `tools/agent-desk/bin/mcp.mjs`: advertised nullable enum for authorized update and subtask creation.
- `tools/agent-desk/src/types.ts`, `src/effort.ts`, `src/components/EffortSelect.tsx`: optional nullable compatibility type, canonical sizing/help/order, reusable select.
- `src/components/CreateDialogs.tsx`, `TicketDetails.tsx`, `WorkView.tsx`, `src/styles.css`: create/detail/inline edit, separate card property, filter and stable direction sorting, responsive grid.
- `tools/agent-desk/tests/effort.test.mjs`, `http.test.mjs`, `mcp.test.mjs`, `browser.spec.ts`, `sync.test.mjs`: TDD, auth/version/session, legacy/restart, metadata/sync and DOM checks.
- `tools/agent-desk/README.md`: user and integration field contract.
- `specs/009-ticket-effort/**`, `.specify/feature.json`: locked contract, tests and verification evidence.

## Design
All new service-created tickets store effort null when absent. Reads decorate legacy missing effort as null without rewriting history. Updates whitelist effort and validate exact XS/S/M/L/XL/null. Agent mutation only gains this planning field through existing session/version/reason guards. Store and GitHub snapshot semantics remain unchanged; outbound/inbound sync retains local effort by preserving existing ticket metadata. Shared UI data gives ordered options and rubric help. Unset sorting is explicitly last for both directions; equal effort preserves source order.

## Verification and Risk
First demonstrate unsupported effort via failing service/API/DOM tests. Reopen an isolated persistent Store for restart proof; assert raw legacy records are unchanged by reads. Test all valid/invalid values, stale versions, foreign/unclaimed sessions, owner and dependency guards, metadata preservation and GitHub incoming updates. Automated DOM create/edit/clear/reload, row/card property, filters and both order directions. Run `npm test`, `npm run build`, `npm run test:e2e` with isolated fixtures and screenshots off. Review raw diff and `git diff --check`. Production cutover belongs to lead and is not claimed here.
