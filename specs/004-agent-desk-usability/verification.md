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
  brief persistence, recovery after creation and font declarations. All 233 existing pixel
  font declarations increased exactly 3px. Retained-ticket recovery and stage/owner/session
  holds were corrected and reviewed clean.
- Intake browser suite: **10 passed** (5.3s), `run-_6lssnhy.log`; real DataTransfer drag/drop,
  real local parsers through the file picker, original downloads, reload, async cleanup,
  folder fallback/dedup, briefs, holds and 320/1440/1920px typography. Build passed in
  `run-r06i9row.log`. A 43px mobile drop-text column was reproduced and corrected.
- Independent rendered preview at port4321 identified the feature worktree. Computed root/
  title/identifier/shortcut fonts were 16/15/13/13px; IDs had equal client/scroll widths87px,
  no page overflow and zero console errors. Manifest and service worker were present.
- Chrome form inspection of tools/agent-desk resolved the repository root, branch, dirty
  state and credential-free GitHub remote correctly, without registering or changing it.
  The native picker timed out with an honest fallback while macOS was locked; unlock was
  requested for native picker completion and Chrome installation.

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

Combined browser suite: **34 passed** (18.0s), `run-vpeubktt.log`; build and 175 Node tests
are green. Source review is clean. [PR #17](https://github.com/jerrywu12/agent-orchestration/pull/17)
merged as `de0183b27e10ef79b77402514201cb1b677804e9` after all three CI jobs passed at
head `8aa711075c6c1d1c340bc6e9fb71f048f191114f`.

On 2026-09-13 (Asia/Shanghai), canonical main fast-forwarded without changing its unrelated
untracked root package.json. The tested app tree exactly matched the merged tree. Installer
preview and apply replaced only `/Users/jerry/.local/share/agent-desk/app`; 14 connector,
guidance and service configuration files stayed unchanged. Only `local.agent.agent-desk`
was restarted. Private recovery evidence:

- Consistent SQLite backup: `~/.local/state/agent-desk/backups/2026-09-13-before-usability.db`.
- Installer rollback manifest: `~/.local/state/agent-desk/installations/2026-09-12T19-01-05-154Z-6340e9e4-da7b-47f8-a037-2841b94c533a/manifest.json`.
- Before/after identity evidence: `~/.local/state/agent-desk/releases/2026-09-13-usability-before.json`.

After restart `/api/health` reported the installed app root and exact merged SHA above.
Assertions verified the same 2 projects, 60 ticket IDs, 11 stage IDs, 11 exact active claims
(ticket, owner, execution, agent, native session, branch and worktree) and unchanged connector
credential bytes. These comparisons preceded this task's own checkpoint/state update.

The deployed browser measured 16/15/13/13px root/title/ID/shortcut fonts, zero clipped IDs
among all 52 visible rows, no page overflow and zero console errors. Its manifest returned
200 and its service worker registered. Screenshot evidence remains private at
`/Users/jerry/Smart-Stock-Picker/.playwright-mcp/agent-desk-live-usability.png`.
Live folder inspection resolved the app subfolder to the canonical repo and its existing
Agent Orchestrator project, without creating anything. All four synthetic document formats
were extracted by the installed runtime, original download bytes matched, and only these
temporary draft attachments were removed after the smoke check.

**Remaining native completion:** macOS was locked, and native control explicitly reported
that automatic unlock could not unlock it. The user was asked to unlock the Mac. Chrome's
standalone app installation and completing the native folder-selection dialog are pending;
the updated app is open in Chrome with its Install app control. No installed/standalone
success is claimed. Resume these two checks after unlock, then finish T013/T014 and AGENT-3.
