# T025 Parity Evidence — Agent Desk vs SwiftBar `codex-status.5s.sh`

**Captured**: 2026-09-15, target Mac (Darwin 25.6.0), with real agent work in flight
**Gate**: SC-010 / FR-021 — authorizes T027 (retiring the plugin)
**Result**: **PASS**, with four divergences, all in Agent Desk's favour and all explained below.

## Capture 1 — initial run: FAILED

The first capture failed the gate and caught two genuine defects.

| | SwiftBar | Agent Desk |
|---|---|---|
| Count | 5 | 6 |
| Workers | 4× Claude, 1× Antigravity | 6× Hermes |
| Overlap | — | **none** |

Agent Desk missed every Claude worker and the Antigravity worker. Root causes, both spec errors implemented faithfully:

1. **Claude CLI excluded as a desktop app.** Exclusion 1 tested for any `.app/Contents/`, but Claude Code ships as a bundle under Application Support (`.../claude-code/2.1.270/claude.app/Contents/MacOS/claude`). `data-model.md` had scoped this exclusion to `/Applications`; the implementation generalised it.
2. **Antigravity worker excluded as an LSP helper.** Exclusion 3 excluded language servers *lacking* the editor flag — the inverse of the real rule. The agent worker runs as `language_server_macos_arm` **without** `--enable_lsp`; the flag's presence is what marks the helper role.

Fixed in `ff92226`, with a regression test built from the real command lines captured here.

## Capture 2 — after fix: PASS

| | SwiftBar | Agent Desk |
|---|---|---|
| Claude workers | 37144, 47698, 64851, 78781 | **same four** ✅ |
| Antigravity worker | 15930 | **15930** ✅ |
| Hermes | not tracked | 18264, 19937, 37219, 47732, 64891, 78818 |
| ArkCLI | not tracked | 8101 |
| Sleep prevention | `inactive` | `active`, holder PID 2195 |
| Spurious entries | 2315, 2319, 2324 | none |

Every unit of agent work SwiftBar identifies, Agent Desk identifies. The differences:

### Divergence 1 — sleep prevention (Agent Desk correct)

SwiftBar reports `inactive` while `caffeinate -is` (PID 2195) has held the machine awake for ~32 h. Its check matches the literal pattern `caffeinate -i /opt/homebrew/bin/codex`, which matches **zero** processes here; the real mechanism is the `com.jerry.agent-caffeinate` LaunchAgent. Predicted in R-005 and confirmed. Agent Desk detects the hold via wrapper recognition.

### Divergence 2 — SwiftBar false positives (Agent Desk correct)

SwiftBar reported PIDs 2315, 2319 and 2324 as Claude and Antigravity workers. They were a `zsh` wrapper, `node arkcli`, and the `arkcli` binary — an unrelated advisory call whose **command line contained agent path strings as prompt text** (`/claude --output-format …`, `language_server_macos_arm`). SwiftBar pattern-matches the whole command line and cannot distinguish a path from a quoted argument, so any command mentioning an agent path is counted as that agent running. Agent Desk did not report them.

### Divergence 3 — broader agent coverage (Agent Desk broader)

Agent Desk tracks Hermes and ArkCLI; SwiftBar tracks only Codex, Claude, Gemini and Antigravity. The six Hermes rows are real `hermes mcp serve` processes and the ArkCLI row is a real inference call. Additional true positives, not disagreements.

### Divergence 4 — Codex task granularity (not exercised)

No Codex task was in flight during either capture, so both reported zero. The task-lifecycle path is covered by unit tests rather than this capture.

## Conclusion

Agent Desk reports a **superset** of SwiftBar's true positives, **none** of its false positives, and corrects its sleep-prevention defect. FR-021 is satisfied and SC-010 passes.

The plugin can be retired (T027). It remains the case that no signal is lost: everything the menu bar showed is available in Agent Desk's Machine view, and three things it got wrong are now right.

## Verification at capture time

- `npm test` — 367/367
- `npm run build` — clean
- `npx playwright test` — 170
- Privacy grep on live `/api/activity` — PASS
