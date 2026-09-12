# Verification record

Source base: 55f6b3073fb24164faf78b4305ae15a11ae17c3e. Branch codex/agent-desk-monitor, isolated worktree /private/tmp/agent-desk-monitor. Live canonical data and independent agent sessions preserved during development. Work tracked as Agent Desk AGENT-2.

## Test-first and independent review

Coordinator/API tests initially failed for the absent module/routes. Current focused HTTP/coordinator lane passes; final suite counts below will be recorded at the release head.

Independent Codex review reproduced slow library discovery blocking the15-second runtime path. The failed regression was captured before separating inventory and runtime promises. Further review reproduced an obsolete failed probe preventing a new agent catalog from receiving an immediate sample; failure-path generation invalidation now passes the same regression. Source changes during in-flight scans,20-source concurrency, close/reopen SQLite persistence, deadline abort and retained data are tested.

The browser fixture server disables automatic collection and injects synthetic collectors, so manual refresh and source CRUD cannot scan the developer/CI host. UI journeys use synthetic metadata; live Mac discovery/rendering is verified separately.

## Pending release verification

- Full Node22 app suite:134/134 pass; TypeScript/Vite production build passes; all24 browser journeys pass. Private agent-run evidence: run-gxlwslcm.log (Node), run-jm7557xu.log (final build), run-zotb08rl.log (combined browser).
- Real Mac collector smoke: Node22.22 on darwin/arm64,808ms;22 agent installations,29 tools,2,358 library records (2,029 installed,288 declared,41 cached),37 sources, no global truncation. Exact native/app process matches present; fixed Agent Desk/DeerFlow/Ollama health endpoints responded. Both optional Hermes endpoints were unreachable. Five sources reported skipped-symlink/unsafe-directory partial coverage, including the temporary dev dependency symlink. No agents were launched, stopped or authenticated by discovery. Isolated native instance at127.0.0.1:4319 reports root /private/tmp/agent-desk-monitor/tools/agent-desk and SHA301ad28b4b81ef61977fe9d5a5a44e81eb273d58. Rendered Refresh and torch library search work;1440px and320px have no horizontal overflow, browser console has zero errors/warnings. Runtime timestamp advances independently from inventory. After explicit refresh, registered roots appear in coverage.
- Independent integrated Codex review is clean after reproduced fixes for Poetry duplicate declarations, inherited object-key metadata lookup, and independent frontend freshness after server restart. Reviewer reran24 collector/coordinator tests successfully. The combined browser suite additionally exposed a test precondition race, reproduced using delayed initial delivery and resolved by waiting for observed initial data before the restart transition. PR/CI pending.
- Merged runtime upgrade, consistent DB backup and rollback manifest: pending.
