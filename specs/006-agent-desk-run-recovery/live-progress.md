# Live run progress regression — 2026-09-13

## Diagnosis before production edits

- Reproduction: user screenshot shows AGENT-3 running with only “Agent started.” The live execution `35dfe8fd-3614-4ea0-9b29-d984b38a7d0c` had sequence14, a fresh heartbeat and a detailed verification/environment status. It later completed independently; no real execution was started for this diagnostic.
- Runtime identity: installed `/Users/jerry/.local/share/agent-desk/app` at `af16b14004dcc453bd96af471d3954806bd937f4`; current source main `567e6a9` differs only by receipt docs. Fix branch `codex/agent-desk-live-run-progress` in `/private/tmp/agent-desk-live-run-progress`.
- Trace: Run Agent → durable batch → exact runner claim → scoped progress/parsed output → Service.event execution summary and heartbeat → coordinator.get persisted dispatch row → two-second React polling → static message. The first broken boundary is the batch read model: it ignores running execution telemetry until terminal release.
- Hypotheses: (1) reporting failed, disproved by fresh execution summary and sequence; (2) polling failed, disproved by its existing two-second loop and the API's persisted message contract; (3) wrong served build, disproved by health and matching deployed source. Deterministic backend and DOM regressions own the failing boundary.
- Risk matrix: exact execution projection and terminal transitions (unit/API); reported zero/null progress and heartbeat-vs-activity freshness (unit/UI); periodic polling/reload and late responses (DOM); queued/already-running/needs-takeover mixed states and replacement claims (integration); network polling error (DOM). No provider invocation or native screenshot needed because transport evidence already advances. Keep prior ownership, completion and archive guards.

## Explicit addendum to the locked implementation contract

This follow-up repairs visibility in acceptance items2/5 without changing execution authorization or adding an automatic takeover.

1. GET /runs/:id projects a bounded whitelist from each row's exact executionId, never the ticket's newer execution. It remains read-only and reflects summary, optional reported percent, state, start/release/heartbeat/real-activity timestamps. Old records with no activity time remain unknown.
2. Heartbeat events do not advance lastActivityAt; accepted non-heartbeat status reports update it. Preserve existing event payload compatibility. Do not manufacture percentage or imply heartbeat means implementation progress.
3. Existing-run rows remain monitored while their exact execution is active; terminal outcomes are retained and never replaced by a newer run. Missing execution records yield an explicit unavailable outcome.
4. UI shows current summary, progress/indeterminate activity, elapsed time, heartbeat health, distinct activity age, batch counts and visible polling status/errors. Preserve request-id fencing, selection and archive behavior. Handle long messages, accessibility and reduced motion.
5. Verification: pre-edit failing tests; focused then full backend/UI/build; independent exact-head review and CI; backed-up install only with no active managed child, live script/API proof and untouched unrelated claims. No screenshots or computer control.

API addition: BulkRun.observedAt ISO; RunResult.telemetry optional with state, summary, progress(number|null), startedAt, heartbeatAt, lastActivityAt, releasedAt, reportingReadyAt (nullable ISO), stale boolean. Existing status/message/executionId remain compatible.

## Evidence

Regression results and delivery are recorded with the PR. This file is the task-scoped diagnosis and acceptance addendum, not a claim of completed delivery.

- Pre-fix backend RED: `run-3shm_6fr.log`, actual “Agent started.” versus reported “Verifying the acceptance tests”. Pre-fix rendered DOM RED: `run-avowgnnk.log`, missing live progress evidence after accepted Start.
- Final backend: 247/247, `run-ze2crmjr.log`. Build: `run-d7fmojxl.log`. Scripted UI: 67/67, `run-ir__e22k.log`, including real HTTP claim/report → database → bulk API → rendered status, zero/55 percent and terminal checkpoint without reload or second executor.
- Edge cases cover exact-run replacement fencing, missing/foreign records, unknown legacy timestamps, stale heartbeats, paused tracking retaining evidence, reload/retry fencing, terminal elapsed/absolute timestamps and absent external mailbox handshake.
- Private full logs are under `~/.local/state/agent-efficiency/logs/`. No model was invoked for the test fixtures. Independent exact-head review, CI and installed runtime/backup evidence are recorded in the PR and AGENT-6 delivery update after verification.
