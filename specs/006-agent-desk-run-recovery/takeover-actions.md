# Visible takeover actions and review status — 2026-09-13

## Pre-edit diagnosis

- User symptom: a bulk result says needs takeover but offers only a ticket-name link saying Inspect takeover. The actual release action exists deep in TicketDetails → ExecutionTracking → trace → confirmation. A completed execution says awaiting review without stating that no reviewer is running.
- Identity: canonical source and installed runtime both `79f0b828becdb6f6b5c161a1aa1369d9140ba28b`; installed root `/Users/jerry/.local/share/agent-desk/app`. Worktree `/private/tmp/agent-desk-takeover-actions`, branch `codex/agent-desk-takeover-actions`.
- Live AGENT-3 evidence: exact execution `35dfe8fd-3614-4ea0-9b29-d984b38a7d0c` released at `2026-09-13T04:19:20.171Z` (12:19 local); its PID is absent; no active claim or linked review child exists. Owner Codex is assignment metadata. There is no automatic reviewer dispatcher; the In progress ticket stage does not prove execution.
- Trace: bulk needs_takeover result → WorkView navigation-only label → TicketDetails → existing guarded takeover API. After revocation, the durable batch still has needs_takeover because its read projection only follows running/already_running rows. Earliest broken boundaries: discoverability in WorkView and post-recovery bulk read state.
- Falsifiable hypotheses: missing takeover server operation (disproved by existing guarded endpoint/tests); hidden UI action (confirmed by component route); active AGENT-3 reviewer (disproved by exact claim/process/child inspection). Backend and scripted DOM regressions capture both actionable display boundaries before changes.

## Explicit acceptance addendum

1. Each needs_takeover result has an explicit Take over action. It opens the existing fresh-trace, audit reason and uncertainty acknowledgement flow directly, pinned to the result's execution ID. A different claim, fresh heartbeat or verified live process prevents takeover; no silent retargeting.
2. Successful explicit revocation becomes claim_released in the exact historical batch, with a visible Run Agent action for that ticket. Launch remains a separate explicit action and uses existing bounded/idempotent batch dispatch. No real stale reservation is revoked or agent launched for QA.
3. Late responses, unmount/navigation, double clicks, trace/refresh errors and already-released claims retain correct evidence and cannot affect another batch or claim. Preserve the existing ownership, replay and archived/Done protections.
4. Awaiting-review results distinguish idle review waiting from a currently active different execution. Completed ticket stages must not falsely say review is pending. This change does not create an automatic reviewer, appoint one, or start AGENT-3 merely to answer a status question.
5. Tests cover unit/API exact-revocation projection, terminal/replacement isolation, real HTTP takeover with synthetic stale claims, DOM direct action/confirmation/retry, changed/fresh trace denial, single-ticket dispatch, idle/active/Done review descriptions, and mobile keyboard behavior. Screenshot/native-computer-control checks are excluded per user preference; use code, APIs and DOM tests.

## Verification and delivery

Focused RED/GREEN, complete backend/UI/build results, independent exact-head approval and CI are recorded with the PR. Deploy only after those gates, preserve a consistent database backup and all unrelated claims, then record the installed SHA and live non-mutating action proof on the implementation ticket.

Local source receipts (Node 22.22; private logs under `~/.local/state/agent-efficiency/logs/`):

- Pre-fix backend RED: `run-0x6e3n45.log`; expected claim_released, actual needs_takeover. Direct-action DOM RED: `run-ir4jny3p.log`; released-claim attention RED: `run-es0ibkwq.log`.
- Full backend: 249/249 passed, `run-lkrythvc.log`, including real HTTP takeover with synthetic claims and separate explicit dispatch.
- Production TypeScript/Vite build passed, final `run-2gj9zxfv.log`.
- Review found that the existing ticket drawer needed an exact execution component identity to reset release state and ignore old responses when the ticket gains a replacement claim. Both open-drawer regressions failed before the one-line identity fix (`run-n1n6da7y.log`); focused GREEN `run-skvbinv9.log`.
- Final full scripted DOM suite: 75/75 passed, `run-wz3xp3nv.log`. Covers direct action, lost responses plus failed refresh, exact-claim protection, idle/active/Done review text, actual delayed callback fencing, same-drawer replacement/pending-old-response behavior and existing intake/archive/progress/mobile journeys. No screenshots or real provider launches.

These receipts establish source behavior. The release PR and AGENT-7 carry subsequent exact-head review, CI, installed-runtime and preservation evidence.
