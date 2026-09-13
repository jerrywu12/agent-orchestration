# Implementation Plan: Bulk Backlog to Planning

**Branch**: `codex/agent-desk-bulk-planning` | **Date**: 2026-09-13 | **Spec**: [spec.md](spec.md)
**Status**: Locked for implementation

## Summary / Technical Context

Reuse the versioned confirmed transition API for each captured candidate. Add native HTML drag handlers and an accessible bulk button in WorkView, with a dedicated batch confirmation/result component. Existing TypeScript, React19, Vite/lucide, Node22.22+, SQLite. No backend/schema/dependency change. Desktop drag plus keyboard/touch alternative, maximum100 candidates. Playwright isolated DOM/API, Node tests, tsc/Vite build.

## Constitution Check

Constitution is an unfilled upstream template, not adopted policy. Concrete AGENTS.md and Agent Desk policy apply: exact claim/scope, TDD, independent review, safe cutover. Pre/post-design passes: stage admission, capacity, timestamps and ownership remain authoritative. Missing accessibility reference file is handled with the fully read skill's keyboard/label/focus guidance and existing Modal.

## Source Structure / Ownership

- Lead: `specs/008-bulk-planning/**`, `.specify/feature.json`, `tools/agent-desk/src/components/BulkPlanningTransition.tsx`.
- UI worker: `tools/agent-desk/src/components/WorkView.tsx`, `tools/agent-desk/src/App.tsx`, `tools/agent-desk/src/styles.css`.
- Test worker: `tools/agent-desk/tests/bulk-planning.spec.ts`, `tools/agent-desk/playwright.config.ts`.
- Independent reviewer: read-only exact final head; no overlapping production writers.

## Design

WorkView snapshots visible selected tickets at drag start (or one unselected source). Accept only same-view in-memory drag with custom MIME marker on Planning; never deserialize external payloads. Clear gesture at drag end/drop; no mutation. Keep empty filtered Planning target available. Own modal within WorkView; App passes integrations.

BulkPlanningTransition props: `tickets: Ticket[]`, live `state`, `integrations`, `onClose`, `onComplete(admittedIds: string[]): Promise<void>`. Resolve exactly one per-project Planning target. List non-Backlog/archived/claimed/missing/stale exclusions. Choose enabled executable available agent (common owner default, otherwise explicit). Recheck live snapshot before each sequential submission; server version guard is final authority. Synchronous ref locks duplicate submission. Freeze batch while busy; per-row progress and final results; no retries from results. Transport/5xx/unreadable responses require inspecting current state before retry. Callback clears admitted selection and refreshes; callback failure is separate and cannot erase success. No atomic batch success claim.

## Verification / Delivery

Pre-fix clarification after first DOM run: useDesk.refresh intentionally catches failures and exposes `desk.error`; pass that existing error as optional `boardError` through App/WorkView to the completed dialog, rather than changing the shared hook. Freeze exclusions at confirmation; later state may only narrow eligibility. Both boundaries have failing regressions before their fixes.

RED before production edit; focused GREEN slice; full Node/DOM/build; independent exact-head review and CI; commit/push/PR/merge. Preview/apply runtime-only deployment only when managed executions are not disrupted. Read-only merged DOM verifies confirmation/cancel with no writes; otherwise report deployment hold separately.

## Complexity

Native drag and existing per-ticket API avoid a drag library or second dispatch protocol. No policy deviations.
