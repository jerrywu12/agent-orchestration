# Quickstart: Verify tracking-only behavior

From `tools/agent-desk` in the feature worktree:

```sh
npm test
npm run build
npm run test:e2e
```

The tests should show a confirmed Planning move with no execution or launch intent, a Ready move that preserves readiness guards, an independently claimed session whose reports update status, HTTP 410 for direct/bulk launch, cancellation of legacy queued intents, and readable historical recovery evidence. Browser tests use an isolated temporary database and synthetic agents.
