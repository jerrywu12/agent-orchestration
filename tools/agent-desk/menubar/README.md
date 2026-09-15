# Agent Desk menu bar indicator

The glanceable robot count in the macOS menu bar, showing background AI agent
work in flight on this machine.

This replaces the retired SwiftBar plugin `~/.swiftbar/codex-status.5s.sh`.

## Why this exists separately from the web app

Agent Desk is a web application and cannot place an item in the macOS menu bar —
that requires a native process holding an `NSStatusItem`. Feature 011 added the
observation and surfaced it in the Machine view, but the Machine view has to be
opened to be read, which loses the property that made the menu bar indicator
useful in the first place: you see it without looking for it.

## What it does not do

It observes nothing. It is a **display client** for `GET /api/activity`. All
detection, bounds, privacy filtering and degradation live in the server
(`server/agent-activity.mjs`), so the menu bar and the Machine view are always
the same observation rather than two implementations that drift apart — which is
precisely how the retired plugin ended up silently wrong about sleep prevention.

## Install

```bash
./install.sh
```

Builds with `swiftc` and installs a LaunchAgent (`local.agent.agent-desk-menubar`)
that starts it at login and restarts it if it exits. Requires the Xcode Command
Line Tools.

```bash
./install.sh uninstall
```

## Display

| Title | Meaning |
|---|---|
| `🤖 N` green | N units of work in flight, and the machine is being held awake for it |
| `🤖 N` orange | N units of work in flight, no sleep-prevention hold |
| `🤖 0` grey | Observed, nothing running |
| `🤖 ?` grey | Agent Desk is not reachable — **not** the same as nothing running |

The menu lists active Codex tasks (origin, description, workspace, short id),
active workers with elapsed runtime, and sleep-prevention state with holders. It
surfaces partial-coverage and stale warnings from the snapshot rather than hiding
them.

`🤖 ?` versus `🤖 0` is deliberate: a zero count must never be shown when the
truth is that nothing could be read. When the server goes away the last known
values are retained in the menu under a "Last known values" heading.

## Configuration

The endpoint is `http://127.0.0.1:4310` — Agent Desk's default. If you run it on
another port, change `endpoint` and `appURL` in `AgentDeskMenuBar.swift` and
reinstall.

Poll interval is 5 seconds, matching the retired plugin's cadence. The server
re-observes every 15 seconds, so the indicator can be at most that far behind.
