# Validation

From `tools/agent-desk`: `npm ci`, `npm run build`, `npm run test:e2e -- bulk-planning.spec.ts`, `npm test`, `npm run test:e2e`; use agent-run for logs.

Isolated temporary database: select two Backlog fixtures, drag onto Planning, assert both listed and no writes, cancel. Repeat choose planner/confirm, assert per-ticket result/own-project stage. Repeat board and keyboard. Exercise held/mixed/stale/partial/uncertain/double-confirm. Never move actual tickets as QA.

After merged safe cutover: health exactSHA/root; separate scripted page with mutation requests blocked; open/cancel dialog and assert zero writes. No screenshots/native computer control.
