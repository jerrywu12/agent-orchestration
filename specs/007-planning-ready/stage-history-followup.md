# Stage history and truthful execution stages

User follow-up, 2026-09-13. This supplements the delivered Planning/Ready contract;
it does not weaken admission, ownership, review, or native-verification requirements.

## Acceptance

- All work no longer shows an Archive results panel. Archive failures and skipped
  tickets remain visible with their ticket identifier; successful rows disappear.
- Each observed ticket stage change records server time, previous/destination IDs
  and captured stage names. The current stage timestamp is distinct from updatedAt.
- Content edits and workflow ID normalization do not reset stage time. Existing
  history is server-owned and survives restarts, stale payloads and rollbacks.
- Historical timestamps absent from legacy data remain unknown; imports record
  observation time, not an invented historical transition time.
- All work shows exact local stage time; ticket details show the ordered history.
- A completed implementation moves an active leaf ticket to In review, never Done.
  A checkpoint, failure, stop or explicitly reconciled/revoked claim returns it to
  Backlog with a retained-work/resume reason. Planning remains Planning; manual
  stage changes and parent containers are preserved. Existing blockers remain.
- Never release unknown/stale external sessions automatically. A newer execution
  cannot be affected by replaying an older terminal report or reconciliation.

## Reproduction and causal trace

Live Agent Desk initially reported AGENT-3 In progress despite an execution already
released in awaiting_review. Its clean executor worktree and merged delivery
evidence showed this was stale board state, not a running development process.
AGENT-9 was independently rechecked as Done/released with merged PR27 and matching
live runtime dd3f373b3138e15b64849d66774cf38a798c6b4f.

Trace: runner/connector terminal report -> Service.event -> saved execution and
activity -> API state -> WorkView. The first broken boundary was Service.event:
it released execution without synchronizing the active ticket stage. Competing
hypothesis of a stale UI was disproved by the API response. Competing hypothesis
of an unfinished worker was disproved by the released execution and clean worktree.
Reconciliation and controlled takeover have the same terminal-state boundary.

AGENT-3 was assigned an independent AI acceptance-resolution review. Four native
folder contract tests and additional injected lock/cancel checks passed. Installed
Chrome registration was verified read-only. No actual native dialog was exercised
under the no-native-UI policy, so its remaining acceptance stays In review rather
than falsely claiming Done. Its remaining reservation is narrowed to native chooser
review, disjoint from this implementation. Other held sessions remain untouched.

## Scope and verification

Storage: server/store.mjs, server/workflow.mjs, tests/stage-history.test.mjs.
Lifecycle: server/service.mjs, server/run-coordinator.mjs and focused regression tests.
UI: src/types.ts, src/components/WorkView.tsx, TicketDetails.tsx, src/styles.css;
tests/browser.spec.ts and tests/recovery-browser.spec.ts.

Test lanes: store/API and lifecycle unit boundaries; workflow normalization and
sync compatibility; terminal idempotency/new-owner concurrency; retained work on
provider/process failure; exact scripted DOM archive/history journey; build/full
Node and DOM suites; independent review, CI and live root/SHA verification.
No dependency installation changes, credential changes, native dialogs or screenshots.

Initial proof: three DOM regressions failed before the UI change; all three then
passed and the complete pre-lifecycle suite passed 93 browser tests. Eight storage
regressions pass with 61 focused backend tests. Final combined verification and
deployment evidence are recorded with the PR and canonical AGENT-11 ticket.

Full combined DOM verification: 95/95 pass, including terminal completion to
review, history after reload, resume notices, archive failures and responsive UI.
Independent reviewers approved storage/UI and lifecycle; independently reran
8 storage and 12 lifecycle tests. The first full Node run passed 283/285 with two
unchanged shell-hook fixtures reaching their 10-second process budget. Isolation
reproduced this on Node 22. A temporary diagnostic retaining all seven original
tests and their assertions passed on Node 22 and 25 with a 30-second budget;
measured cold executable startup was slower than warm/direct startup, consistent
with accumulated fixture subprocess overhead. The hook fixture budget alone
is increased to 30 seconds, without skipping tests or changing production hooks.
