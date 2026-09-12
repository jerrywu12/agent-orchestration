# Agent Desk desktop and intake verification

Feature branch: `codex/agent-desk-usability`, based on `aae5a50`.
Source: `/private/tmp/agent-desk-usability`; canonical repo: `/Users/jerry/agent-orchestrator`.

## Readability regression

The supplied screenshot showed tiny fonts and `SMARTSTO…` identifiers. Before editing,
the live `/api/health` identified `/Users/jerry/.local/share/agent-desk/app`, SHA
`9873d370b7571e756a3fd967b153a190e2accf5e`. At a 1440px viewport the complete DOM value
`SMARTSTO-20` had client width 66px and scroll width 76px, with hidden overflow and ellipsis.
Root/title/identifier type measured 13/12/10px. The baseline browser assertion failed
in `run-mwoa1l_4.log`.

Trace: stored project key and ticket number → state API → `ticketKey` → WorkView identifier
span → CSS fixed 66px column (55px at the smaller breakpoint) → clipped rendered text.
The fixed column hypothesis was confirmed by measured overflow. Truncated server data was
falsified by the complete DOM value, and stale-runtime suspicion by the health root/SHA.
The first broken boundary was CSS sizing. Adjacent checks include long keys, 1440/1920px
desktop widths, mobile, board/detail views, navigation and shortcut text.

## Backend, extraction and independent review

- Full Node suite: **175 passed**, 9.17s, private `run-mizzzobh.log`.
- Parser: **16 passed** after failing preimplementation fixtures; synthetic TXT, CFB DOC,
  DOCX and PDF, Unicode chunk boundaries, signatures, malformed archives, external resources,
  page/text/archive limits, empty/scanned text, cancellation, concurrency and worker lifetime.
- PWA: **10 passed**; independent review also ran the suite and inspected HTTP/static/auth.
  Install metadata, honest install state, offline navigation, no API/cache/write queuing.
- Store/API/packet checks cover draft limits/expiry/restart, original downloads, assigned-agent
  access, UTF-8 storage quota, atomic binding, stable identities and bounded untrusted context.
- Folder fixtures cover dirty/empty/worktree repositories, canonical roots, credential-free
  remote detection, duplicate registration, cancellation and permission/timeout behavior.
- Independent backend review found three P2 defects: child-folder duplicate detection,
  extracted-text quota accounting, and caller-supplied duplicate IDs. All received failing
  tests and fixes before the full suite. Metadata listing now avoids selecting full text.
- Frontend source review covered uploads, cleanup, previews/downloads, async folder races,
  brief persistence, recovery after creation and font declarations. Browser verification
  and final corrections are recorded below when complete.

Tests use temporary databases, repositories and synthetic documents. No host inventory,
real agent launch, GitHub issue mutation or private document fixture is part of CI.
Word extraction is pinned to 1.0.4; a narrow subclass supplies validated decoded XML to
its parser to avoid the upstream chunk-boundary Unicode bug. This is covered by a real
multibyte fixture and must be reviewed on dependency upgrades. Worker heap limits are
V8 heap limits, not total RSS limits. PDFs requiring OCR remain explicitly unsupported.

## Workflow research and scope

[Primary-source research](research-workflow.md) supports bounded acceptance criteria,
scope/verification briefs, explicit claims, isolated worktrees, checkpoints and separate
review/delivery evidence. The UI labels recorded references and missing/unverified evidence.
It does not claim to enforce verified CI/merge from a PR URL or stage alone. Existing runtime
claim, owner, dependency and stage holds remain authoritative. Attached text is reference
data, never execution authority; extraction does not fetch links or invoke a model.

## Integration and deployment

Pending final combined browser checks, native Chrome installation and merged deployment.
Live delivery must record exact merged SHA, consistent SQLite backup, installer preview/
rollback manifest, active-claim preservation and a standalone Chrome app window. This source
record does not claim those operations have happened yet.
