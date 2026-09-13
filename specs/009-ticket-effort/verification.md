# Ticket Effort Verification

Implementation source head: `5a5bb2003b3518621b5693cfae1d7f1bae70bca6`.
Base: `f0b8e47529306bb85234446ff0ff816a62c10db3`.
Isolated checkout: `/private/tmp/agent-desk-effort`, branch `codex/agent-desk-effort`.

## Acceptance Coverage

- Nullable XS/S/M/L/XL field is separate from labels in storage, service, HTTP, MCP and UI; absent historical values read null without rewriting records.
- Create/edit/clear persists through browser reload and SQLite close/reopen. Exact enum validation rejects invalid types and values without partial writes.
- Existing stale-version, owner/session, agent-field, stage and readiness guards remain enforced. Estimates do not alter stage history, ownership, dependencies, task brief or active execution.
- GitHub incoming changes preserve local effort and effort does not become an outgoing label.
- Create/details show the development/tests/verification/review rubric; list has inline Effort control and board a separate Effort property; mobile control remains visible.
- Effort filters include Unset and combine with search/priority. Effort and requested Priority/Owner/Stage changed/Name sort in both directions, stable for ties and missing last. Owner uses display name and stage time ignores updatedAt.
- Project and All Work preserve grouping, filtering and selection under sort. Active sort remains visible and clearable with Filters collapsed.
- Original deployed confirmation fingerprint is unchanged. Synthetic pre-Effort legacy tickets and queued Planning intents survive a real Service restart and dispatch exactly once for unchanged/effort-only updates. Real title/scope updates still invalidate confirmation.

## Test-First Evidence

Initial service tests failed on absent field/default, accepted invalid estimates and unsupported agent update. Initial DOM journeys failed on missing Effort control and column. Additional requested sort journey failed on missing Priority sort option. Review reproduced hidden active ordering after collapsing Filters. Raw diff review and independent review found effort accidentally added to launch fingerprint; a new test failed on the exact fingerprint change before correction. All these regressions now have passing automated coverage.

## Final Gates

- `npm test`: 325/325 pass on implementation source head (17.2s).
- `npm run build`: TypeScript validation and Vite production build pass on implementation source head.
- Targeted DOM: four journeys pass, including multi-project/two-stage All Work and collapsed-filter sort visibility.
- `npm run test:e2e`: 143/143 pass on implementation source head (1.6m), with screenshots and traces disabled.
- Full branch raw diff reviewed; `git diff --check` against the pinned base passes after removing spec Markdown hard-break whitespace.

## Release Boundary

No live Agent Desk database changes, provider launches, installation or shared-service restart were performed in this slice. Browser tests used the repository's temporary SQLite/server fixture with machine discovery disabled, screenshots and traces off. The lead owns independent final review, push/PR/merge, installed runtime identity, live effort population and post-cutover proof. Source verification does not claim global delivery.
