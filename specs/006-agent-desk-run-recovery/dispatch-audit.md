# Dispatch workflow regression audit

User request, 2026-09-13: verify and fix the related Run Agent workflow. A single SMARTSTO-8 request reports Agent run in progress / 2 concurrent / 1 tickets while no execution starts.

## Captured diagnosis

Live and isolated base: dd3f373b3138e15b64849d66774cf38a798c6b4f. Runtime root /Users/jerry/.local/share/agent-desk/app; source /private/tmp/agent-desk-dispatch-audit. Run 67882847-df1c-4d43-b9ad-85cc0c12dd61 requests one ticket with concurrency2. SMARTSTO-8 still has its exact released/revoked old execution. SMARTSTO-5 has a real managed child and fresh heartbeat. Other retained provider claims are mostly stale. No real claim takeover or start was performed during diagnosis.

Trace: Run Agent -> durable batch creation -> queued row -> coordinator drain -> ownerBusy -> no dispatch -> projected batch state running -> unconditional running heading and configured-limit label. The first broken boundary is admission using provider-wide retained claims as runtime capacity. UI independently conflates pending authorization with working agents.

Ranked hypotheses: actual managed capacity exhaustion is disproved by one child against a limit2; provider-wide claim starvation is confirmed by ownerBusy and retained unrelated Codex claims. A provider quota error is not observed: SMARTSTO-8 has not reached the launch adapter.

Independent audit also reproduced alternate direct/confirmed starts bypassing capacity, a queued Planning confirmation replaying after a different run checkpoints, and changed queued content hidden behind a busy check. Existing restart contracts deliberately fail interrupted bulk requests while retaining still-valid confirmed Planning/Ready intents; preserve those semantics.

## Correction contract

1. Managed capacity is supervised child occupancy, including terminal-but-not-yet-closed children, never all provider claims. Preserve the existing conservative workspace ceiling: max4, reduced by the smallest concurrency requested by outstanding running batches. Apply it to direct, bulk and confirmed launches. Same-provider independent work can use multiple slots.
2. Exact ticket claims, disabled/unsupported agents, missing project setup, readiness/scope conflicts, and changed confirmed payloads are validated before claiming a capacity wait. Stale claims keep their ownership and scope; never automatically revoke them. Explicit blocker/recovery resolution retains its existing scoped purpose.
3. Persist truthful queued reason/code and queuedAt. A capacity wait names used/limit. Initial acceptance says waiting for dispatch, not that a scarce slot was observed. Avoid timestamp churn and write loops on unchanged waits. Child close/flush drives re-admission.
4. Every successful execution claim binds pending authorizations for that exact ticket to that exact execution. Direct/external starts cannot leave an old queued confirmation or batch to replay after completion. Read models follow only that execution and preserve its history. Failed spawn/terminal transitions remain visible without duplicate provider work.
5. Queued-only view says Waiting to start; mixed attention and queued says Action required; running heading requires observed working execution. Configured concurrency is labeled Agent limit, ticket grammar is singular/plural, and queued waiting time never masquerades as agent execution duration. Pending submission and restoration are distinct. Do not invent a starting phase without backend evidence.
6. Keep uncertainty/retry/exact-request guards, takeover's separate Run action, all ownership/refusal safeguards, stopped/checkpoint/review distinctions, and non-replaying bulk restart behavior. Do not restart an installed supervisor while a managed child is active.

## Ownership and verification matrix

Root owns capacity/service/coordinator/runner contracts, source integration and release. UI worker owns WorkView/RunProgress/styles and UI regressions only after the contract and RED. Scope: those modules, bulk types if needed, their tests, canonical policy and this audit. No unrelated stage-history/native-picker changes.

Regressions cover same-provider parallel slots, unrelated stale ownership, exact stale target refusal, all-entry capacity, invalid queued content while full, claim/intent/batch binding, completion-before-next-drain, child exit/refill, changed tickets, unavailable adapter, scope/dependency conflict, restart and replay, and queued/running/attention UI with reload/polling failure. Real SQLite/fake provider and HTTP/DOM tests own boundary/lifecycle/concurrency; provider quota collection is unchanged. No new screenshot, computer control or native UI testing.

Production edits wait for overlapping AGENT-11 source ownership to finish; independent diagnosis and failing tests continue. Board tracking is AGENT-12 (unclaimed during this wait). Advisory DeerFlow failed due ReadBeforeWriteConfig.elide_blocked_payloads; local evidence and independent code audit remain authoritative.

## Pre-fix executable evidence

- 16 new scheduler/real-runner tests: 15 assertion failures, with exact stale-target preservation passing (`run-ixc3xtqw.log`). Actual synthetic Runner exceeded 4/4 and 1/1 limits before the fix; no model providers or network calls were used.
- Six scripted DOM regressions: queued-only/mixed attention/submission status failures (`run-398rmxzp.log`) and fresh external/suspended/interrupted reservations wrongly counted as working (`run-rv3x3z2i.log`). Baseline build passed (`run-6vkt8e2p.log`). Test-server port collision was excluded as evidence; follow-up UI tests use an isolated private port4328 harness with screenshots/traces off.
- Fresh external/suspended/interrupted reservation telemetry is not proof of a working agent. These states need attention/inspection guidance, without relabeling old percentages as current progress.

## Integrated repair evidence

PR28 lifecycle changes at 0dc4aba were merged into this branch before production edits; AGENT-11 released its exact claim. AGENT-12 then acquired execution380b949a-da9a-47bc-809f-ee45e581d454. All20 stage/lifecycle cases remained green while the15 dispatch failures reproduced on the integrated base (run-9rpodrgx.log).

The new18 dispatch cases now cover actual Runner capacity, unrelated stale claims, exact takeover reservation, changed confirmations under full capacity, concrete invalid-launch outcomes, no-churn waits, fast completed claims, duplicate batches, and automatic close/bridge-flush refill. The additional duplicate-batch case failed on immutable pre-fix068e6ee (run-3yjattvu.log); the existing actual close/flush contract passed there and remains preserved (run-24mpbxlu.log). The original16 dispatch cases passed with the repair;30 confirmed-admission/coordinator cases pass (run-m4dadh09.log). Legacy queue fixtures now model occupied supervised children rather than treating an external provider claim as capacity.

UI build passed (run-rrd9x1ul.log). Recovery DOM32 cases are covered:31 passed in run-254_r0m_.log and the remaining queued/reload/poll failure case passed in run-tt0uesjm.log after correcting only a new-test locator to the existing Retry run tracking label. No screenshots, native controls or live task launches were used for these checks.

Related user request from the concurrent task: Archive must remain available for selected completed/unreserved tickets while an unrelated run is queued or working. The other lead is preparing standalone RED evidence; one UI writer will integrate the bounded action-guard repair here, retaining server-side exact-claim refusals and partial-failure reporting. No duplicate production writer.

Archive followup: independent live and standalone RED on0dc4aba showed the global runActive guard disabled Archive before any write (run-loinco1n.log, all3 cases). The serialized change removes only unrelated run/takeover state from archive gating. The real-API/DOM cases now pass for queued/running unrelated batches and mixed active selections; exact active reservations are refused, successful Done archives persist, errors/failed selections remain, and no agent is started (run-a58odjy2.log). Production build passed (run-oysuuj95.log). Full303 backend tests passed (run-khhqd2wc.log).

Independent review of9c4c5bb requested two corrections: Git setup preflight was still behind capacity, and synchronous failure after claim overwrote the durable batch execution binding. Five new tests reproduced both on994c792 (run-j8gp6rk2.log). Git root/base now validates before waiting, and failed dispatch retains its transactionally bound execution and telemetry across overlapping batches and later replacements. All48 focused dispatch/runner/coordinator tests pass (run-1_mhuhr6.log).

The first complete DOM run passed103/104 (run-pkwoexba.log). Its legacy real-API progress test expected an external reservation to be labeled already working before a first report. It now asserts Action required/external session before the report and Agent run in progress after actual progress, retaining live updates/exact identity/terminal checkpoint coverage. That focused case passes (run-o2g3lg4o.log). No production change was needed for this assertion correction.
