# AGENT-13 verification

## Identity and baseline

- Base/source: 8c8cc2f479ee328a7519ebb14bd3790d71091983 in isolated `/private/tmp/agent-desk-bulk-planning`, branch `codex/agent-desk-bulk-planning`.
- Live health initially same SHA, installed root `/Users/jerry/.local/share/agent-desk/app`. New code not yet deployed.
- Exact AGENT-13 claim:138faa98-53cd-4803-8437-3433b6a33709, native session01a098f9-f20c-7253-93e4-9fe450f2b6e6. Prior AGENT-12 scope released/Done before production edits.

## Pre-implementation proof and trace

Existing checkbox selection→WorkView article had no draggable attribute/drop handlers; only single-ticket stage dropdown→StageTransition→POST transition existed. Seven new DOM cases failed against unchanged built production: list/board draggable absent, bulk Planning button absent. RED log: `run-ntlhtenm.log` (agent-run private logs). No existing product bug inferred beyond requested missing feature.

New path: captured visible selection→same-view drag token→Planning preview→explicit planner confirmation→versioned per-ticket transition→transactional stage/history/owner+launch intent→capacity/claim dispatch→per-ticket results→board refresh. Backend contract unchanged.

## Checks so far

- Existing backend suite:308/308 passed, `run-oza71624.log`.
- First expanded DOM run:15/16 passed, `run-zlo6wljz.log`; failed refresh warning test correctly exposed swallowed boolean refresh result. Primary list/board drag-and-confirm, payload mapping, cancel, mixed/held/stale and duplicate protection passed.
- Independent draft review found exclusion widening during in-flight batches; regression required before fixing.
- Exclusion-widening RED: `run-erl0_zyc.log`, expected1 POST observed2 after held claim released in-flight. Fixed frozen confirmation exclusions; later rechecks can only narrow.
- Production build passed `run-7rfgkakt.log`; focused17/17 passed `run-r0kcxciu.log`; full121/121 DOM passed `run-ua21uy6r.log`.
- Independent reviewer approved exact production head99832c002036cc6a4712badc9542120731bf36bc across correctness/readability/architecture/security/performance after reviewing the regression and fix.
- Native pointer-drag follow-up: board drag passed; list default row-center hit its Stage SELECT and emitted only pointerdown, not dragstart (`run-j4iwyrni.log`, diagnostic `run-oejpdipa.log`). Native dragging from ID SPAN or title BUTTON emitted article dragstart, custom-MIME dragover/drop and opened the complete selection. This is an interactive-control test target issue, not a production defect; preserve editable dropdown and exercise actual ID drag surface. No speculative production change.
- Final focused19/19 passed including native List/Board gestures, `run-onow30fy.log`. Production unchanged from independently approved99832c0; only native test coverage/formatting and evidence added afterward.
- CI, merge and live cutover remain pending; do not treat tested source as delivered.

## Risk matrix

- Component/DOM: list/board drag-confirm, cancel, empty filtered/collapsed target, unselected drag, external/invalid target, button/keyboard, unavailable owner.
- Concurrency/errors: version conflict, held execution, excluded candidate release, double-click, partial refusal/uncertainty, refresh failure, retained selection/results.
- Persistence/API: real isolated API cancellation preserves stage/owner/version/history/execution; unchanged backend308 tests cover transactional admission, durable queue/history and claim guards. No real providers invoked by new tests.
- Regression: full existing browser suite including Archive and Run Agent.
- Native GUI/screenshots: not used per repository policy; automated DOM/API only.
- Merged runtime: exact health/root and separate read-only scripted confirmation/cancel, no real user ticket moves/launches.
