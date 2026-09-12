# Implementation Plan: Agent Desk
**Branch**: codex/agent-desk | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

## Summary
Independent self-hosted web app in tools/agent-desk. React/TypeScript/Vite frontend,
Node 22.23+ HTTP server, built-in SQLite, fixed-command agent runners, GitHub CLI transport,
CLI/stdio MCP connector, read-only Kangentic migration and reversible installation.

## Technical Context
- Storage: SQLite WAL, transactions, unique active execution per ticket, JSON entity documents
  with optimistic versions, event uniqueness and strict execution sequence.
- Testing: node:test real temporary databases and fake GitHub transport, Playwright browser.
- Platforms: local macOS service; Linux Docker; persistent data outside git.
- Scale: personal multi-project workspace, thousands of tickets, <5 second progress refresh.
- Auth: loopback trusted operator mode permits local callers only, strict Host and Origin.
  Remote binds require administrator secret; per-agent bearer tokens restrict identity and
  claim/event endpoints. Browser remote login uses HttpOnly SameSite cookie; secrets stay server-side.
- GitHub: existing gh identity, durable sync jobs, 3-way baseline comparison and explicit conflicts.
  User Project 1 exists for SSP; preserve it and its 18 fields and existing items.
- Execution: assignment does not spawn. Explicit Start requires configured supported adapter,
  owner, ready dependencies, unblocked work, safe existing project path and atomic claim.
  Stale claims remain owned; no automatic takeover. Stage auto-start is opt-in.

## Constitution Check
Existing constitution is an unfilled scaffold. Apply root AGENTS.md: isolated worktree;
preserve unrelated files; one writer per module; source tests plus installer smoke; PR and
independent review; no secrets or machine-local data in git. Passed before/after design.
No new framework bootstrap needed because .specify is already present.

## Project Structure and Ownership
- server/store.mjs and server/service.mjs: records, validation, transactions, claims/events (lead).
- server/http.mjs and server/runner.mjs: API, auth, execution, polling (lead).
- server/github.mjs: standalone injected-transport GitHub synchronization (bounded worker).
- src/** and index.html: frontend strictly consuming locked API (bounded worker).
- server/migrate.mjs, bin/**: migration, CLI/MCP, deployment and wiring (lead after core).
- tests/**, package.json, vite config, Dockerfile/compose, README (lead; worker owns named tests).
- scripts/agent_workflow.sh and scripts/codex_auto_dev.sh: board event hooks, serialized cutover.
- docs/AGENT_DESK_POLICY.md, root roles and templates: replace Kangentic-only guidance.

## Sequence and Release
Lock contract and write failing core tests; implement store/service/API. Frontend may run
independently after immutable API contract is saved; no shared file edits. Integration code must
pass its contract tests before connection to core. Implement CLI/MCP/migration; verify fixture
import and browser; create installation preview; back up and deploy to a stable local path;
import actual data without dispatch; replace legacy writers/connectors, then verify live UI.
Run source suites/installer smoke, independent review and PR checks; merge only with evidence.

## Risk Controls
Never import session prompts/transcripts/secrets. Preserve unknown routing metadata privately.
Never treat an exit code as delivery. No GitHub writes caused by import. Sync existing links
only unless explicitly publishing an individual ticket. Exclude PRs from issue imports.
No arbitrary executable configuration through ticket or untrusted imported text.
