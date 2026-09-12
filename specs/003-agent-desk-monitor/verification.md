# Verification record

Source base: 55f6b3073fb24164faf78b4305ae15a11ae17c3e. Branch codex/agent-desk-monitor, isolated worktree /private/tmp/agent-desk-monitor. Live canonical data and independent agent sessions preserved during development. Work tracked as Agent Desk AGENT-2.

## Test-first and independent review

Coordinator/API tests initially failed for the absent module/routes. The focused HTTP/coordinator lane and final release suites pass; counts and evidence are recorded below.

Independent Codex review reproduced slow library discovery blocking the 15-second runtime path. The failed regression was captured before separating inventory and runtime promises. Further review reproduced an obsolete failed probe preventing a new agent catalog from receiving an immediate sample; failure-path generation invalidation now passes the same regression. Source changes during in-flight scans, 20-source concurrency, close/reopen SQLite persistence, deadline abort and retained data are tested.

The browser fixture server disables automatic collection and injects synthetic collectors, so manual refresh and source CRUD cannot scan the developer/CI host. UI journeys use synthetic metadata; live Mac discovery/rendering is verified separately.

## Release verification

- Full Node 22 app suite: 134/134 pass; TypeScript/Vite production build passes; all 24 browser journeys pass. Private agent-run evidence: run-gxlwslcm.log (Node), run-jm7557xu.log (final build), run-zotb08rl.log (combined browser).
- Real Mac collector smoke: Node 22 on darwin/arm64, 808 ms; 22 agent installations, 29 tools,2,358 library records (2,029 installed,288 declared,41 cached), 37 sources, no global truncation. Exact native/app process matches present; fixed Agent Desk/DeerFlow/Ollama health endpoints responded. Both optional Hermes endpoints were unreachable. Five sources reported skipped-symlink/unsafe-directory partial coverage, including the temporary dev dependency symlink. No agents were launched, stopped or authenticated by discovery. Isolated native instance at 127.0.0.1:4319 reports root /private/tmp/agent-desk-monitor/tools/agent-desk and SHA 301ad28b4b81ef61977fe9d5a5a44e81eb273d58. Rendered Refresh and torch library search work; 1440px and 320px have no horizontal overflow, browser console has zero errors/warnings. Runtime timestamp advances independently from inventory. After explicit refresh, registered roots appear in coverage.
- Independent integrated Codex review is clean after reproduced fixes for Poetry duplicate declarations, inherited object-key metadata lookup, and independent frontend freshness after server restart. Reviewer reran 24 collector/coordinator tests successfully. The combined browser suite additionally exposed a test precondition race, reproduced using delayed initial delivery and resolved by waiting for observed initial data before the restart transition.
- [PR #15](https://github.com/jerrywu12/agent-orchestration/pull/15) merged as 9873d370b7571e756a3fd967b153a190e2accf5e after review and all three [CI checks](https://github.com/jerrywu12/agent-orchestration/actions/runs/34709661521) passed at head 6b6d78af826ab3e7c842dd41b1a116c9b1590144: shell lint + smoke, shared agent tooling tests, and Agent Desk tests + browser. The canonical checkout fast-forwarded to the merged commit; its tree matched the tested feature tree c143377f2e7269d23572304db73e5856b8a3e709.

## Installed runtime and preservation proof

The authorized upgrade was previewed and applied on September 13, 2026 (Asia/Shanghai). Only the installed app directory changed; 14 installer entries, including six client configurations and the LaunchAgent, remained unchanged. Only `local.agent.agent-desk` was restarted. The isolated native verification server on port 4319 was stopped afterward.

- Consistent SQLite backup: `/Users/jerry/.local/state/agent-desk/backups/2026-09-13-before-machine-monitor.db`.
- Immutable installer rollback manifest: `/Users/jerry/.local/state/agent-desk/installations/2026-09-12T17-59-36-167Z-c548a2ad-ee3b-42df-9165-771cd23eb914/manifest.json`.
- Installed health at `http://127.0.0.1:4310/api/health`: status `ok`, storage `ready`, root `/Users/jerry/.local/share/agent-desk/app`, SHA `9873d370b7571e756a3fd967b153a190e2accf5e`.
- Live Machine page: 22 agent installations, 29 supporting tools and 2,423 library records across 37 sources (2,106 installed, 276 declared, 41 cached). No global truncation or inventory/runtime error. Skipped symlinks remain explicit partial-coverage notices. These are bounded metadata observations, not proof that every discovered library is loaded by a running agent.
- Browser verification of the installed build: Machine heading present, no horizontal overflow at 1440px, zero console errors/warnings. The runtime timestamp advanced while the inventory timestamp stayed unchanged, confirming the independent collection cadence. The isolated browser and coordinator checks also verified source configuration persistence; native journeys covered refresh, library search and 320px layout.
- All 59 tickets survived the upgrade. An exact comparison of active execution `(id, agent_id, session_id)` values against the backup matched all 11 claims. After this check, only this task's AGENT-2 execution was intentionally completed and released. Other agents' claims were preserved.
- A scoped Codex credential received HTTP 403 for `/api/machine`; administrator access succeeded. Source configuration remains in SQLite, and collectors expose metadata without credentials, process arguments or session transcripts.
- [AGENT-2 / issue #14](https://github.com/jerrywu12/agent-orchestration/issues/14) is closed and the local ticket is Done, assigned to Codex, with no blocker. Its released execution records the merged SHA, PR and delivery evidence. Final GitHub sync is idle with zero pending operations, no conflict and no error.

This follow-up records deployment evidence only. It does not require another app restart; the installed code remains the verified PR #15 build.
