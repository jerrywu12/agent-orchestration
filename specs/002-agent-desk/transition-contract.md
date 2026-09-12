# Explicit transition contract addition

Live cutover inspection on 2026-09-13 found Kangentic-hosted native sessions still running.
The replacement must preserve their process and claim while new work routes to Agent Desk.
This adds a narrow transition observer to the implementation plan before its implementation:

- Read only allowlisted lifecycle fields for sessions already mapped by the migration manifest.
- Record source status and observation time, explicitly described as legacy-source evidence.
- Never read transcripts, environment, credentials or commands; never write source databases.
- Never manufacture progress percentages or heartbeats, release ownership, infer delivery, or
  overwrite editable ticket stages. A source exit remains subject to exact-session reconciliation.
- Stop projecting once a retained execution has a new progress event or is reconciled.
- Missing/unavailable source is visible and retains ownership.

Implementation: server/legacy-observer.mjs; integration in server/http.mjs; temporary-source
regressions in tests/legacy-observer.test.mjs. This is a cutover compatibility adapter;
fresh work uses the stable Agent Desk CLI/MCP and never starts through the old source.

Runtime compatibility was verified on Node22.22.0; the package minimum is explicitly adjusted
from the initial plan's22.23 estimate to22.22. No storage/API contract change is involved.
