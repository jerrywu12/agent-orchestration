# Feature Specification: Agent Desk desktop and task intake

**Feature Branch**: `codex/agent-desk-usability`
**Created**: 2026-09-13
**Status**: Locked for implementation
**Input**: Install Agent Desk as a Chrome app; increase overall fonts by 3px; fix clipped SMARTSTO identifiers; research and improve development workflows for AI agents; accept and process TXT, DOC and PDF ticket documents; pick project folders and reuse existing repositories.

## User Scenarios & Testing

### US1 — Read and launch Agent Desk comfortably (P1)
Users install/open Agent Desk in a standalone Chrome window and read complete ticket identifiers and larger text.
Acceptance: existing computed typography increases by exactly 3px at each responsive breakpoint; identifiers up to the supported key length remain fully visible; 320px, 1440px and wide desktop flows remain usable without page overflow. Chrome recognizes install metadata and launches the app independently. If server is unavailable, show an honest connection/offline screen, never cached operational success.

### US2 — Create tickets from documents (P1)
Users drop or choose up to five TXT, DOC, DOCX or PDF documents, see processing status/extracted text, remove a draft document and create a ticket retaining originals and extracted context.
Acceptance: Unicode text and text-based Word/PDF documents produce a readable preview; original download and text survive reload/restart; owned-agent task retrieval and runner context include attached references. Oversized, unsupported, corrupt, encrypted or scanned-only documents give explicit errors; a failed file never silently disappears or starts work. File contents are untrusted reference material, not authorization or instructions. Files remain local and are not automatically published to GitHub. Limits: 10 MiB/file, five files/ticket, 100,000 extracted characters/file; bounded extraction time and concurrency. OCR is outside this slice and scanned PDFs explain that text is required.

### US3 — Register an existing project folder (P1)
Users choose a server folder (native Mac picker when available, browsable server-folder fallback elsewhere) and Agent Desk discovers its repository.
Acceptance: resolved path, suggested name/key, GitHub remote and branch/readiness are visible before creation; subfolders resolve to the existing Git root; no clone/init/reset/checkout or credentials are copied; registered folders open their existing project instead of duplicating it. Non-Git folders are allowed and clearly identified. Cancel and unavailable picker preserve form input. Browser directory handles are not mistaken for server absolute paths.

### US4 — Give agents clear development packets (P1)
Users can enter acceptance criteria, bounded scope and verification instructions during ticket creation/editing, inspect a workflow checklist and copy a start/checkpoint/review packet.
Acceptance: brief fields persist and reach both MCP/API task context and runner; reference attachments remain distinctly labelled. Checklist distinguishes assigned/ready/claimed, implementation, verification, independent review and delivery evidence. Existing dependency/ownership holds, exclusive claims and complete-to-review semantics remain unchanged. Review and merge evidence are displayed as recorded or missing; never claim GitHub-verified merge/CI from a manually entered URL or closed issue. No automatic executor launch on upload/assignment/project creation.

### Edge cases
Malformed uploads, misleading MIME/extension, archive expansion, metadata/path injection, extraction timeout/crash/concurrency, removal during processing, duplicate uploads, reload, unknown attachment IDs, cross-agent access, remote-host picker calls, dirty/worktree/non-Git folders, duplicate canonical paths, cancelled native dialogs, absent Chrome install prompt and server offline.

## Requirements
- FR01: Standalone install metadata, icons and install affordance with truthful fallback.
- FR02: All current text sizes increase 3px; identifiers never use destructive ellipsis.
- FR03: Local authenticated bounded document extraction, draft cleanup and durable ticket binding, safe download and text retrieval.
- FR04: Mac folder chooser and server folder browsing/inspection; preserve existing repository state and automatically reuse registered canonical roots.
- FR05: Structured optional task brief and evidence checklist/copyable context, linked through UI, HTTP, MCP and execution prompt.
- FR06: Public research supports the selected workflow and documents remaining policy-versus-runtime boundaries.
- FR07: Test-first regressions, independent review, green CI, consistent backup, install preview and verified native cutover preserving unrelated sessions.

## Key Entities
Task brief (acceptance criteria, scope, verification); attachment (identity, original name/hash/size/type, extracted text/warnings, draft expiry or ticket link); folder inspection (canonical path, Git metadata, existing project); workflow checklist (derived observations, not fabricated verification).

## Assumptions
Single self-hosted workspace and current admin/scoped-agent authentication remain. Creating a project registers a folder; it does not create or publish a repository. Existing tickets and stages remain compatible. Imported documents need text extraction, not cloud summarization or OCR. Current optional brief fields improve the work packet without blocking capture/triage or retroactively changing existing execution rules.

## Success Criteria
All five requested product areas work in rendered/native verification; full ticket identifiers visible; exact +3px computed samples; all supported document formats survive creation/reload and reach assigned agents; duplicates reuse the existing project; unrelated active claims are unchanged across deployment; release suites and independent review pass.
