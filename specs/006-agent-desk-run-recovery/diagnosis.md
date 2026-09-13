# Pre-edit diagnosis

Live API health: root /Users/jerry/.local/share/agent-desk/app, SHA1e9e34794e0860416791119ee0012f8e9832f4c0. Canonical source main5a856ff is documentation-only newer. Worktree starts clean at5a856ff; unrelated root package.json preserved.

## Reproduction evidence
AGENT-3 execution f927a806-8fcc-4af1-9c40-17172e6ea560 and SMARTSTO-46 execution1d7ff6de-8ee7-4f21-9eca-815d62f6eabc actually started2026-09-13 02:32UTC and ended~90-120seconds later. Activity records quote both agents unable to call MCP due noninteractive approval, then HTTP CLI fetch failed. They explicitly reported remaining blockers, no code changes. Both worktrees clean. Supervisor unconditionally overwrote summary with “Agent process completed; verification and review remain.” and state awaiting_review.
AGENT-3 Chrome standalone bundle now exists; read-only plist verified ID com.google.Chrome.app.pajpndbkkpococbainjbkdmjeofacebf and URL http://127.0.0.1:4310/. Its old Mac-unlock blocker is stale. Native UI verification must follow the user's code/script-only instruction.
SMARTSTO-46 is duplicate-reference; canonical SMARTSTO-16 has retained external session60b1e5b9-f26f-4145-8bc2-2aaf97d98caf and preserved S05 uncommitted work. This real reservation cannot be erased by a failed duplicate run.

## Trace and hypotheses
User Start -> HTTP admin -> Runner.start -> Service.claim(resolveBlockers) -> isolated worktree -> codex exec --json -> global MCP approval denial / sandbox HTTP denial -> no agentUpdate/checkpoint -> stdout captures accurate final message -> exit(0) sends complete -> persisted awaiting_review and generic summary -> UI hides actual unresolved cause behind process success.
H1 launch blocked: disproved by native thread.started/progress and two isolated clean worktrees.
H2 reporting channel denied: supported by both exact agent messages; falsifier is sandboxed claimed-ticket read/update/checkpoint via a token-free local mailbox.
H3 legitimate unresolved dependencies: supported for S05 original reservation. Fixing transport must still preserve it and record handoff.
First broken boundary: managed agent transport cannot execute previously authorized scoped board operations. Second independent bug: process success conflates task outcome.

## Risk-based matrix
Node boundary: pre-fix zero-exit blocked regression; mailbox validation, file races/symlinks/bounds, session fencing, last summary/terminal preservation. API: admin-only trace/takeover/bulk, optimistic heartbeat comparison, active archive refusal. Integration: real sandbox helper read/write/checkpoint, provider thread identity capture, duplicate/batch overlap, queue restart. Native inventory: injected process/registry metadata and read-only actual matching. UI: scripted DOM selection, partial outcomes, recovery confirmation, stale response/poll cleanup, no screenshots. Cache: trace fresh at takeover; batch durable restart behavior. Data: backup and unchanged external claims/worktrees through deploy. Provider error: failures/exit signal/no terminal preserve actionable state. No model-generating real ticket QA.

DeerFlow advisory failed with ReadBeforeWriteConfig.elide_blocked_payloads error. Hermes advisory failed HTTP429 weekly quota; neither is implementation evidence.

## Executable proof
Pre-fix blocked zero-exit regression failed awaiting_review vs checkpointed: private log run-_5hwwdbh.log. Post-fix runner+recoveryHTTP16/16 pass run-b7g_f3iu.log. Full backend240/240 pass run-8cqzvivl.log.
Native installed Codex0.154.0 sandbox proof /private/tmp/desk-sandbox-bridge-proof.mjs and .log: no model call; mailbox read/update/checkpoint exit0, readiness recorded. Simultaneous loopback connection and protected .codex write both denied EPERM. Provider defaults unchanged by production code. Standalone sandbox uses explicit test-only workspace-write because its default differs from exec; early standalone read-only and syntax failures were test-harness diagnostics, not managed-run evidence.

Research: [BullMQ stalled jobs](https://docs.bullmq.io/guide/jobs/stalled) documents heartbeat loss and bounded restart counts. Agent Desk applies conservative operator recovery because coding jobs may retain uncommitted work and run outside its supervisor; this is a design choice, not BullMQ's default. [Codex sandbox source](https://github.com/openai/codex/blob/main/codex-rs/cli/src/debug_sandbox.rs) grounds the native reproduction boundary. No queue library was added.
