# Verification evidence

Implementation branch: codex/agent-desk-workflow-status; base d3999b15746a2403ac0ff0a5d3a321ce412e30a0. All checks ran from /private/tmp/agent-desk-workflow-status/tools/agent-desk on Node 22.

- Full Node suite: 208 passed, private log run-xtshkcr1.log.
- TypeScript and production build: passed, run-sbls2b10.log.
- Full Chromium suite: 53 passed, run-3c2lrq1v.log, isolated database and disabled host collectors. Includes +3px/full-identifier regression, four document formats, folder registration, mobile overflow, fixed stages, resolver Start and quota freshness.
- Independent UI slice: 19 browser tests; desktop/mobile screenshots inspected. Root combined suite includes these tests.
- Passive installed Codex CLI: real quota read succeeded in 1.932 seconds, two buckets/three windows. Only initialize, initialized and account/rateLimits/read were sent. The owned process exited and auth/config size+mtime were unchanged. A sandbox-only SQLite runtime-state denial was resolved by authorized execution permissions, with no code workaround.
- Private consistent live-data copy migration: two projects, 61 tickets, eleven stages to ten, two Parked tickets to Backlog. Eleven active claims and all eighteen execution rows were unchanged, along with sync jobs and project/publish intent. Second migration was a no-op. No live user ticket was started during testing.
- Pre-fix fake-CLI regression failed BLOCKED before dispatch; after the fix it starts resolve_blockers in an isolated worktree, retains blocker/dependency and foreign reservation, and reaches awaiting_review rather than Done. Scoped API/MCP tests prove actual updates/subtasks and reject foreign sessions, owner spoofing, stale versions, cycles, completion and archive changes.

Coverage limitations are explicit in the product: only Codex currently has a verified passive quota adapter. Other providers give unavailable reasons; launcher presence and Machine health are separate observations. Hermes advisory invocation reached its upstream weekly quota; DeerFlow advisory request failed with a local compatibility error. Neither was used as verification evidence. Independent Codex review is required before merge.

The earlier Chrome-native installation remains blocked by the locked Mac; no installed-app claim is made. It is tracked separately by AGENT-3. Source PWA/readability/document/folder functionality remains covered by the combined browser suite.

Review, PR/CI and merged-runtime adoption evidence will be appended after completion.
