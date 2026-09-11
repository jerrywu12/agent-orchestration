# Kangentic Board Policy (All AI Agents)

Last updated: 2026-09-07

This is the canonical board-synchronisation policy for every AI coding agent Jerry uses: Claude Code,
Codex / Codex Cloud, Gemini CLI, Antigravity, Cursor, ARK/arkcli lanes, and any agent added later.
Compact notices in each agent's global config mirror this document; when they disagree, this document
wins.

It sits alongside [`SPEC_KIT_POLICY.md`](SPEC_KIT_POLICY.md): Spec Kit governs *how work is defined*,
this governs *how its state is reported*.

## Why

Work gets done and the board goes stale. That is not a cosmetic problem — a ticket that says
"in progress" when the branch is abandoned, or "done" when the PR is still a draft, is worse than an
empty board, because someone plans around it. Agents are especially prone to this: a lane finishes,
its session ends, and nothing outside the transcript records what actually happened.

The rule is therefore about *truth*, not bookkeeping. An agent that updates a ticket is asserting
something it has verified.

## Scope — what belongs on the board

**On the board:** any work item that is documented in a project's backlog, has a `specs/<nnn>-<slug>/`
directory, or was dispatched to an implementer lane. If it has a plan and an owner, it has a ticket.

**Not on the board:** exploratory reads, one-line fixes, answering a question, or anything that
leaves no artifact. Do not manufacture tickets for conversation.

**One ticket per work item, not per PR.** A feature delivered across five PRs is one ticket carrying
five links, not five tickets. A ticket is the unit a human plans around.

## When to sync

Update the ticket at these four moments, and not on every commit:

| Moment | What changes |
|---|---|
| **Start** | Move to in-progress; record the owner (which agent/lane) and the branch |
| **State change** | Blocked, handed to another lane, scope amended, decision needed from Jerry |
| **Delivery** | Merged, with the commit SHA and PR link |
| **Stop without delivery** | Abandoned, quota-killed, superseded — say which, and where the work sits |

That last row is the one agents skip. **A lane that dies mid-task must leave the ticket saying so.**
Silence reads as progress.

## What an update must contain

Write what a person needs to plan around, not a changelog:

- **Verified state, not intended state.** "Gate green, PR open, unmerged" — not "done".
- **Evidence**: PR link, commit SHA, and the check that proves it (the gate command and its result).
- **What is explicitly NOT done.** Partial delivery reported as delivery is the failure this policy
  exists to prevent. If seven of ten review findings are fixed, the ticket says three remain.
- **Named blockers with owners.** "Awaiting Jerry's decision on X" is a state; "blocked" alone is not.

## Truthfulness rules

These mirror the engineering discipline already required elsewhere in this repository, and they apply
to ticket text exactly as they apply to a PR body:

1. **Never mark a ticket delivered without the evidence in the ticket.** A passing local test is not
   delivery; a merged SHA is.
2. **A draft PR is not delivered.** Neither is a green gate on an unmerged branch.
3. **Do not close a ticket you cannot verify.** If you cannot reach the branch or the gate, say so.
4. **Contradictions get resolved, not layered.** If the ticket and the repository disagree,
   investigate which is wrong and fix it; do not append a newer comment and leave the old claim.
5. **Report the board update in your reply to Jerry.** He should not have to open the app to learn
   whether you synced it.

## Connecting to Kangentic — UNRESOLVED, do not invent

**There is currently no configured Kangentic integration on this machine.** Verified 2026-09-07: no
`kangentic` MCP server in any scope, no `kangentic` CLI on `PATH`, and no reference in any project
repository. The only trace is a stale temp-directory entry in `~/.claude.json`
(`/var/folders/.../T/kangentic-model-probe`), which is a leftover model probe, not a board connection.

Until Jerry supplies the access method, every agent must follow this fallback:

- **Do not invent an endpoint, API shape, ticket ID scheme, or CLI invocation.** Guessing an
  integration and reporting success is strictly worse than reporting the gap.
- **Do the in-repo half**, which is real and already required: the project's own backlog and handoff
  board (for example `vcp_research/docs/BACKLOG_CONSOLIDATION_DEV_PLAN.md` and
  `HANDOFF_PUNCHLIST.md` in Smart-Stock-Picker). Those stay authoritative.
- **Then state plainly in your reply** that the Kangentic ticket was not updated because no
  integration is configured, and include the exact text you would have written so Jerry can paste it.

When the integration exists, replace this section with the access method and delete this warning.
The expected shape, for whoever wires it up:

```
# MCP (preferred — matches how every other connector here is reached)
claude mcp add -s user kangentic --transport http <url>
# then authorize once via /mcp in an interactive session
```

An agent that finds this section still unresolved has found a blocker to report, not a puzzle to
solve.

## Ownership

The agent that owns the work owns its ticket. When work is handed to another lane, the handing agent
records the handoff before the new lane starts; the receiving lane owns it from there. A reviewing
agent does not silently re-own a ticket — it comments and hands back.
