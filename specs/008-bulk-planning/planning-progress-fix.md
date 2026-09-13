# AGENT-14: planning confirmation and blocker-resolution correction

## Revised contract (2026-09-13)

The user's 22:51 and 22:52 screenshots supersede the retained final-results dialog contract. Confirm immediately dismisses the modal and exposes a non-modal Planning progress region, including while submission is pending. Keep one-shot submission, frozen exclusions, version checks and individual failures. Poll existing board state for real execution summaries, reported percentage (never fabricated), heartbeat and terminal status. Reload must recover current planning status without replaying any POST. Finished submission is not finished planning. Active planning with retained blockers is resolving blockers; stale/ended/external execution must not be presented as active resolution.

Planning's first task is evidence-based blocker investigation and resolution within the planning scope. Preserve dependency holds, foreign ownership and production/Ready gates. Do not blindly clear blocker history or restart SMARTSTO-60/61, which already have managed planning workers.

## Pre-edit diagnosis

- Reproduction: screenshot shows successful launch text still inside the modal. Current source always renders Modal for preview/submitting/finished and records static launch-result strings. WorkView refresh does not dismiss it or project planning telemetry.
- Runtime identity: GET health reports installed `/Users/jerry/.local/share/agent-desk/app`, SHA `b1fb5742b944ea9a83835f6ae53fdb48fbca7b1e`. Fix checkout `/private/tmp/agent-desk-planning-progress`, branch `codex/agent-desk-planning-progress`, same base. SMARTSTO-60 execution `0bb130af-7500-4928-94c1-02bc77cef2e4` and SMARTSTO-61 execution `a31d176d-c9df-4290-9389-4db5cf2c5280` were running with retained historical blockers.
- Trace: drag/selection -> captured ticket/version -> confirm -> per-ticket transition -> stage/owner/launch intent -> planning claim -> launcher -> response -> static modal strings -> board refresh. Existing four-second state polling returns execution telemetry but planning UI does not consume it.
- Hypothesis 1: provider launch/network hung. Disproved by finished modal plus actual running execution and fresh heartbeat.
- Hypothesis 2: modal lifecycle fails to hand off to live progress. Proven by unconditional Modal rendering and absence of planning telemetry projection; component regression should fail until modal disappears while POST is held.
- Hypothesis 3: blocked flag prevents planner claims. Disproved by live running planners and two passing service regression tests. Planning packet lacks proactive first-task blocker-resolution instructions (one pre-fix failing test).
- First broken boundaries: confirmation state -> rendered surface; planner task packet -> explicit first-task blocker-resolution guidance. No service ownership bypass is needed.

## Risk-based checks

| Lane | Required proof |
| --- | --- |
| Component lifecycle | Held POST closes modal immediately; one-shot; admitted selection cleared; errors remain outside modal |
| State/telemetry | Queued -> running -> terminal; latest summary/percentage; stale heartbeat and refresh warning; reload no POST |
| API/concurrency | Existing version/confirmation and frozen-exclusion cases; malformed/uncertain/partial responses |
| Provider/blocker | Planning can run blocked; evidence-bearing own-ticket update; foreign claim/dependency retained; packet resolution-first |
| Exact journey | List and board native drag, cancel zero writes, confirm progress DOM |
| Cache | No new cache; retained response snapshot during refresh failure and authoritative newer board state |
| Release | Full Node/DOM/build gates, independent review, CI, merged SHA and live read-only progress proof; preserve active workers during cutover |

Production edits follow the failing component and packet regressions. Real user tickets are inspected read-only; isolated/mocked tests own mutation proof.

Pre-fix component RED: both held-POST modal-dismissal and reload/live planning-progress tests failed against unchanged source (`agent-run` log `run-xnep1ynh.log`). Pre-fix packet RED: two service safeguards passed and the proactive planning instruction assertion failed. The first implementation build exposed obsolete modal-phase branches and callback typing; these were removed/corrected before behavioral verification.

Independent draft review identified a further identity risk: a newer failed launch intent without executionId could borrow an older checkpoint's telemetry. Failed and queued intents now take precedence; started intents without an exact execution binding remain unknown, never reuse older progress. Regression coverage includes this boundary.

## Verification before publication

- Build/typecheck GREEN (`run-lp10ze2x.log`).
- Full backend suite: 311 passed (`run-g0v4b6yr.log`), including evidence-bearing blocker updates and preserved foreign claims/dependencies.
- Final full DOM suite: 135 passed (`run-v91wtw70.log`), including 31 bulk-planning cases. No real provider launch or user-ticket mutation.
- Confirmed failing modal boundary now passes with the first POST held; nonmodal results and telemetry remain visible. Poll/reload updates summaries and percentage without replay. Native list/board drag, cancellation, frozen exclusions, partial failure/uncertainty, refresh failure, missing/stale heartbeat and exact-session binding pass.
- Checkpoint is explicitly not declared completed preparation: `checkpointed` shows Planning checkpointed; actual `awaiting_review` shows Prepared for review. Retained blockers take attention precedence.
- Live cutover proof and exact-head independent approval must be recorded on AGENT-14/PR after merge; source tests alone are not deployment evidence.
