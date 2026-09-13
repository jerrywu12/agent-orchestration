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
- Final full DOM/build, exact-head independent review, CI, merge and live cutover remain pending; do not treat interim checks as delivered.

## Risk matrix

- Component/DOM: list/board drag-confirm, cancel, empty filtered/collapsed target, unselected drag, external/invalid target, button/keyboard, unavailable owner.
- Concurrency/errors: version conflict, held execution, excluded candidate release, double-click, partial refusal/uncertainty, refresh failure, retained selection/results.
- Persistence/API: real isolated API cancellation preserves stage/owner/version/history/execution; unchanged backend308 tests cover transactional admission, durable queue/history and claim guards. No real providers invoked by new tests.
- Regression: full existing browser suite including Archive and Run Agent.
- Native GUI/screenshots: not used per repository policy; automated DOM/API only.
- Merged runtime: exact health/root and separate read-only scripted confirmation/cancel, no real user ticket moves/launches.
