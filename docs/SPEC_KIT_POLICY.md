# Spec Kit Policy (All AI Agents)

Last updated: 2026-08-08

This is the canonical spec-driven development policy for all AI coding agents Jerry uses: Claude Code, Codex / Codex Cloud, Gemini CLI, Antigravity, Cursor, and any agent added later. Compact notices in each agent's global config mirror this document; when they disagree, this document wins.

GitHub Spec Kit is installed globally as `specify` (`/Users/jerry/.local/bin/specify`). Keep it current with `specify self upgrade`.

## Why

AI agents rabbit-hole when there is no locked definition of done, no scope boundary, and no cheap rollback. Spec Kit addresses the first two by making the spec the source of truth and the plan/tasks reviewable artifacts before any code is written. Agents must not substitute ad-hoc planning for this workflow on new features or substantial changes.

## Auto-Trigger

Jerry does not type `/speckit-*` commands. Recognize the intent from natural language and route to the matching Spec Kit phase:

| Intent | Trigger words | Phase |
|---|---|---|
| Write a spec | "spec", "specify", "write a spec", "requirements", "feature spec", "PRD" | `speckit-specify` |
| Dev plan | "dev plan", "development plan", "implementation plan", "technical plan", "design doc", "how should we build" | `speckit-plan` |
| Task breakdown | "tasks", "break this down", "task list", "work breakdown" | `speckit-tasks` |
| De-risk a spec | "clarify", "open questions", "what's ambiguous" | `speckit-clarify` |
| Consistency check | "analyze", "does the plan match the spec", "cross-check artifacts" | `speckit-analyze` |
| Quality checklist | "checklist", "acceptance criteria coverage" | `speckit-checklist` |
| Project principles | "constitution", "project principles", "engineering standards" | `speckit-constitution` |
| Remaining work | "what's left", "converge", "gap vs spec" | `speckit-converge` |
| File issues | "turn tasks into issues", "create GitHub issues" | `speckit-taskstoissues` |

## Rules

- Normal phase order: constitution (once per repo) → specify → clarify → plan → tasks → implement. Enter at whatever phase the request names; do not silently run later phases.
- Specs and locked plans are immutable during implementation. If implementation reveals a gap, stop and revise the spec/plan explicitly — do not patch around it.
- Scope boundary: tasks name their files and their verification command. Changes to files not named by the current task are scope creep; stop and surface them instead of "fixing along the way".
- Rollback over patch-loops: commit (or checkpoint) before each implementation step. Two failed fix attempts on the same error means revert and re-plan, not a third patch.
- Do not trigger Spec Kit for one-line fixes, questions about existing code, or debugging. It is for new features and substantial changes.

## Bootstrap

The phase skills require a `.specify/` directory in the repo root. If it is missing when a trigger fires, say so and ask once, then run from the repo root:

```bash
specify init --here --integration <id>
```

Add `--force` only for a non-empty directory. Never run outside a git repo, and never in a repo Jerry has not approved. Integration IDs: `claude`, `codex`, `gemini`, `agy` (Antigravity), `cursor-agent`, `hermes`; see `specify check` for the full list.

## Per-Agent Command Surface

| Agent | Repo-level artifacts | Invocation |
|---|---|---|
| Claude Code | `.claude/skills/speckit-*` | `/speckit-*` skills / natural-language routing |
| Codex / Codex Cloud | `.agents/skills/speckit-*` | `$speckit-*` prompts |
| Antigravity | `.agents/skills/speckit-*` | `/speckit-*` workflows |
| Gemini CLI | `.gemini/commands/speckit.*.toml` | `/speckit.*` commands |
| Cursor | `.cursor/skills/speckit-*` | `/speckit-*` skills |

## Implementation Split (Codex Offload)

`speckit-implement` executes code changes, so it follows the Codex Cloud offload rule:

- Claude, Gemini, and other advisory agents stop after `speckit-tasks` and hand off, unless Jerry explicitly asks that agent to implement.
- Codex / Codex Cloud is the default implementation runner: it picks up at `speckit-implement` from the locked spec, plan, and tasks, and owns tests, commits, PR, and verification.
- A handoff should include objective, relevant files, constraints, acceptance criteria, required verification, and desired return format — most of which the spec and tasks artifacts already carry.

## Mirrors

- Claude: `/Users/jerry/.claude/CLAUDE.md`
- Codex: `/Users/jerry/.codex/AGENTS.md`
- Gemini CLI: `/Users/jerry/.gemini/GEMINI.md`
- Antigravity: `/Users/jerry/.gemini/antigravity/global_rules.md`
- Cursor: `/Users/jerry/.cursor/rules/spec-kit-workflow.mdc`
