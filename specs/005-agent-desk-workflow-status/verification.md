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

Review, PR/CI and merged-runtime adoption are recorded below.

## Completed release

- Independent Codex review approved a98d473b9239e4d7f23169b9d403917c2e238461 with no P1/P2 blockers. All three CI jobs passed on that exact head (run 34715070214).
- [PR #19](https://github.com/jerrywu12/agent-orchestration/pull/19) squash-merged as 1e9e34794e0860416791119ee0012f8e9832f4c0. The canonical checkout was fast-forwarded, preserving its unrelated untracked root package.json. The merged app tree exactly matches the tested branch tree.
- Installer preview and apply changed only the runtime directory; fourteen existing connector/configuration artifacts were unchanged. Consistent SQLite backup: `~/.local/state/agent-desk/backups/2026-09-13-before-workflow-status.db`. Rollback manifest: `~/.local/state/agent-desk/installations/2026-09-12T19-49-37-878Z-b7695ec3-6ef9-46d0-8fe7-5bb057926f34/manifest.json`.
- Only local.agent.agent-desk was restarted. Live `/api/health` reports root `/Users/jerry/.local/share/agent-desk/app` and SHA 1e9e34794e0860416791119ee0012f8e9832f4c0. Post-migration fingerprints proved 61 tickets, eleven active claims, ticket content, scoped tokens and pending sync intent were preserved; stages changed from eleven to ten. Both projects then reported idle sync with zero pending errors.
- Real browser proof: SMARTSTO-20 remains blocked by `dependency`, has no active claim, and now displays an enabled Start agent button with blocker-resolution guidance. No real ticket was started. Its stage selector and list headings show the five canonical names. Visible SMARTSTO identifiers have equal client/scroll widths (95px), with no clipping.
- Live Agents displays fresh Codex usage from codex-app-server with three reported windows/reset timestamps and explicit unavailable reasons for other provider limits. Browser console: zero errors/warnings. Screenshots inspected: `agent-desk-live-resolver.png` and `agent-desk-live-capacity.png` in the local `.playwright-mcp` artifact folder.
- AGENT-4 was completed with this PR/merge evidence and moved to Done; only its own claim was released, leaving ten other active reservations. AGENT-3 remains separately blocked on native Chrome installation while macOS is locked.
