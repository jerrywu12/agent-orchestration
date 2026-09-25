# Implementation Plan: Agent Desk Tracking Only

**Branch**: `codex/agent-desk-tracking-only` | **Date**: 2026-09-25 | **Spec**: [spec.md](spec.md)

## Summary

Turn the existing Agent Desk app into a passive progress tracker. Keep exact claims, progress reports, readiness and historical recovery. Refuse every new managed launch at the service boundary and align UI and agent guidance.

## Technical Context

**Language/Version**: Node.js 22+, JavaScript server and TypeScript/React UI.
**Storage**: Existing SQLite records.
**Testing**: Node tests, Vite build, Playwright Chromium suite.
**Target Platform**: Local macOS app and Docker-compatible web server.
**Constraints**: Preserve current sessions and recorded evidence; do not mutate live ticket data as QA.

## Constitution Check

The repository constitution is an unfilled template. `AGENTS.md`, `docs/PROJECT_DEVELOPMENT.md` and `docs/AGENT_DESK_POLICY.md` supply the executable gates: isolated branch, exact source tests, browser DOM checks, no screenshots, PR review and safe cutover.

## Design

1. Cancel persisted queued/awaiting intents on service startup; transition returns a status move without an intent.
2. Reject direct and batch starts in the runner/coordinator before process or database mutation.
3. Retain exact claim and event paths; an agent report can still advance Planning to Ready and implementation to In review.
4. Remove launch actions from the board and update status text for unclaimed tickets and independent sessions.
5. Update canonical policy, user guidance and installed connector notice.
6. Replace launch-only tests with tracking, reporting and historical recovery coverage.

## Gate

`npm test`, `npm run build`, `npm run test:e2e`, `git diff --check`, and the repository CI checks must pass before merge. Native service installation/restart is a separate cutover.
