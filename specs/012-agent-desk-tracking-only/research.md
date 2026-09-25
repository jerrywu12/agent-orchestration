# Research: Tracking-only boundary

## Decision

Keep Agent Desk's exact claim and progress model, while removing server-owned dispatch from stage transitions and direct/bulk launch entry points.

## Evidence

- `server/service.mjs` previously created launch intents in `transition` and retried queued intents in `dispatchConfirmed`.
- `server/runner.mjs` owned managed CLI process starts, and `server/run-coordinator.mjs` accepted bulk starts.
- The stable CLI/MCP connector already supports independent exact-session claims and progress events.
- Existing execution and takeover views provide read-only evidence and guarded recovery that remains useful.

## Alternatives considered

- Keeping explicit Run Agent was rejected by the user's clarification.
- Removing claims and progress reports would prevent agents from keeping the board current.
