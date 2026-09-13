# Recovery progress clarification

User request, 2026-09-13: show progress after takeover and explain whether work has started. This change clarifies the existing separate takeover and Run Agent actions. A combined action is a pending product preference, not part of this change.

## Diagnosis before production edits

- Runtime: installed `/Users/jerry/.local/share/agent-desk/app`, health SHA `f7ccbe3fdebee6e5af753422e56430068249d375`; isolated source `/private/tmp/agent-desk-recovery-progress` starts at the same SHA.
- Reproduction: SMARTSTO-8's exact imported execution was revoked at `2026-09-13T06:58:56.280Z`, with no replacement execution. The UI says claim released and offers Run Agent, but still labels the batch finished and shows the prior execution's elapsed/heartbeat data. SMARTSTO-5 remains reserved and awaiting takeover.
- Trace: Confirm takeover -> pending component state -> exact-claim takeover API -> persisted revocation -> batch projection `claim_released` -> WorkView title and RunProgress. The server correctly releases only the recorded claim; the first broken boundary is presentation of recovery state as execution progress.
- Hypothesis 1: a replacement starts but telemetry is lost. Disproved by the persisted revoked execution, absent replacement and release-only server path. Hypothesis 2: generic terminal presentation conflates claim recovery with task execution. Confirmed by the unconditional finished title and old-session progress rendering.
- RED: two scripted DOM journeys fail against the baseline build because Action required and Takeover complete are absent. Receipt: private `run-nzgatb0o.log`. An earlier occupied test-port setup failure was excluded as evidence.

## Acceptance and verification matrix

1. Pending confirmation announces takeover in progress without a fabricated percentage.
2. Recovery-only completed batches say Action required. Waiting and successfully released claims have explicit status; successful release displays its recorded timestamp when valid.
3. A released claim states that the agent has not started and points to Run Agent. Current replacement reservations, closed tickets and unavailable ticket state supersede that guidance; invalid starts are disabled.
4. Prior session telemetry stays available in collapsed Previous session details and is not presented as current recovery progress.
5. Reload, delayed/lost responses, duplicate clicks, trace refresh and exact-execution guards retain existing behavior. Normal running, queued, terminal progress and separate explicit dispatch remain unchanged.
6. Component/DOM coverage owns labels, lifecycle, current-state changes and exact user journey. Existing API/SQLite/coordinator tests own revocation, persistence and dispatch concurrency; no schema, provider, credentials or backend changes are needed. Provider/cache math is N/A for this presentation change. Live verification reads existing records without taking over or starting real tickets.

## Delivery evidence

- Implemented the presentation correction without changing takeover or dispatch APIs. Pending confirmation announces progress; the completed recovery shows its timestamp and current ticket guidance. Previous-session details are collapsed, and replacement/closed/missing ticket states disable row start.
- Local Node 22.22 verification: 251 backend tests (`run-1xngdyg6.log`) and production build (`run-kfxivky9.log`) passed. The 79-journey DOM run passed 78 and found a test-only ambiguous timestamp locator; scoped it to the recovery row and the remaining complete/reload/replacement/closed journey passed (`run-ncm6flor.log`). The full CI suite will run the final test tree. The original two RED failures are absent after the change.
- Independent review, required CI and installed runtime proof remain release gates. No screenshots, computer control, real claim takeover or provider launch were used for verification.
- Review finding: a different execution that later checkpoints or awaits review was classified as never started because only active replacements were recognized. The exact DOM transition from replacement active to released reproduced this before the correction (`run-mla0baak.log`). Recovery must point to the later session's result and preserve the original session history; it must not invite an accidental duplicate rerun.
