# Implementation Plan: Agent Desk desktop and intake

Status: locked. Branch `codex/agent-desk-usability`, base `aae5a50`; local execution because this change depends on macOS/Chrome and installed private data. User requested implementation, so the lead owns specify → plan → tasks → implement through reviewed deployment.

## Technical context
Existing Node 22 HTTP/SQLite service, React/TypeScript/Vite frontend and project-local Playwright. Add PDF.js and word-extractor for portable local text extraction. No cloud model calls, Office dependency or uploaded-file execution. Auth, Host/Origin protection, transactional claims, GitHub conflict logic and isolated worktrees remain authoritative.

## Constitution check
The bootstrap constitution is still an unfilled template. This feature follows actual AGENTS.md, PROJECT_DEVELOPMENT.md and AGENT_DESK_POLICY.md: isolated branch, bounded ownership, fixture-only tests, independent review, green CI, preview/backup before native deployment. No invented constitutional rules or extra approval gate. The template is not treated as an approved contract and is not rewritten as part of this feature.

## Architecture and ownership
- Lead owns shared types, HTTP/auth, attachment SQLite store, service integration, runner/MCP packets, Git folder helper, API tests, lockfile, fixture server/config, research/spec and delivery docs.
- Parser worker owns document-processor.mjs, document-worker.mjs and parser tests/fixtures only. Bounded worker threads (128 MiB heap, 20 seconds, max two concurrently), signature checks, archive size limits, plain text only.
- Frontend worker owns styles.css, WorkView/CreateDialogs/TicketDetails/App UI, intake UI helpers and intake-browser.spec.ts. Existing typography declarations increase exactly 3px before new styles. Folder and attachment contracts are frozen below.
- PWA worker owns public manifest/icons/offline/service worker, index.html, pwa.ts/main.tsx, InstallAppButton.tsx and pwa tests. Uses existing button classes; no shared CSS/App edits. Lead integrates MIME/static headers. No API caching, queued writes or invented offline success.
- Read-only independent reviewer checks integrated changes after writers finish.

## Storage and interfaces
Attachment originals and extracted text live in a dedicated SQLite table with ticket_id or draft expiry (24h), immutable metadata and SHA256. Five per ticket; ten MiB per original; 20 draft files and 1 GiB total attachment bytes bound storage. Binding is atomic with ticket creation; metadata-only state payloads, full context only in owned ticket/detail requests. Public asset handlers cannot expose uploads. See contracts/api.md and data-model.md.

Folder helper uses argv-only timed Git probes and strips remote credentials. Read-only inspection canonicalizes real paths and resolves Git roots/worktrees, inspects HEAD and dirty state, detects supported GitHub SSH/HTTPS remotes. Native macOS picker is loopback-admin-only and asynchronous with cancellation/deadline; fallback browse lists at most 200 direct directories. Never initialize, clone, switch or mutate selected repositories.

Task brief is optional structured data persisted with tickets and included in scoped context/dispatch. Existing runtime guards remain; evidence checklist states observations/missing evidence explicitly and never asserts verified merge/CI from an entered URL. A bounded execution packet includes clear untrusted attachment sections and directs the agent to scoped full context for truncated text.

## Verification and release
Pre-edit clipping reproduction: live root /Users/jerry/.local/share/agent-desk/app, SHA9873d37, 1440px; SMARTSTO-20 clientWidth66 vs scrollWidth76, overflow hidden/ellipsis. Root13px/title12px/ID10px. Hypotheses: fixed CSS column (confirmed by widths); truncated server data (falsified by complete DOM); stale build (falsified by health). First broken boundary is CSS sizing, not identifier generation. Test baseline screenshot/width assertion before fixing. Adjacent cases: 12-character keys, boards, small screens, modals, Machine tables.

Tests cover parser malformed/limit/time/empty-text, auth/scoped access, draft binding/expiry/restart, packet trust labels, repo duplicate/dirty/worktree/no-remote/cancel, response races, font deltas/key visibility, installability/offline behavior. Full npm test/build/test:e2e, independent diff review and CI. Local native preview with synthetic data first; consistent installed DB backup and immutable installer rollback, preserve active sessions, upgrade only merged app, install Chrome app and verify exact live SHA and rendered flows.
