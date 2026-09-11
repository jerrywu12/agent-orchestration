# Claude — Agent Orchestrator

Read `AGENTS.md` for this repository's identity, scope, verification and deployment rules, then the relevant section of `README.md`.

Default role: requirements, planning, diagnosis and bounded advisory work. Put new feature contracts under `specs/` through the shared Spec Kit workflow. Handoffs identify the exact checkout, owned paths, observations, acceptance commands and unresolved decisions. Codex normally owns implementation and final verification unless the user assigns work differently.

This repository maintains the shared orchestration infrastructure. Its `templates/CLAUDE.md.template` is for downstream projects; it is not this repository's own task packet. The local queue does not execute a Claude adapter. Use the host session for planning and follow the shared efficiency policy without copying whole histories into handoffs.

## Board synchronisation

Canonical policy: `docs/KANGENTIC_BOARD_POLICY.md` — mirrored for Claude, Codex, Gemini CLI,
Antigravity, Cursor and ARK lanes; when mirrors disagree, the canonical doc wins.

Any work item with a backlog entry, a `specs/<nnn>-<slug>/` directory, or an implementer dispatch
carries one Kangentic ticket. Update it at four moments: start, state change, delivery, and **stop
without delivery** — a lane that dies mid-task must leave the ticket saying so, because silence reads
as progress. Report verified state with evidence (PR link, SHA, the check that proves it) and say
explicitly what is NOT done; a draft PR and a green gate on an unmerged branch are both "in review",
not "delivered".

### Stages

`To Do` → `Planning` → `Executing` → `PR / Code Review` → `Done`. The stage is a claim about where
the work is, so advance it only on evidence: move to PR / Code Review when the PR exists (post the
link), and to Done only on merge to `main`.

**Planning** is a real stage with artifacts — analyse the ticket's requirements against the code
(`file:line` evidence), write a comprehensive spec and executable acceptance tests, then break the
work into the smallest independently verifiable child tickets so lanes can build them in parallel.
This stage is the Spec Kit flow (`speckit-specify` → `clarify` → `plan` → `tasks`). A child ticket is
its own work item; the parent stays open until every child is Done.

Planning is assigned to **Codex by default**, falling back only on unavailability or quota:
`codex → claude → ollama/arkcli → antigravity → gemini`. Record which agent actually planned it.

Backward moves are legitimate and must carry a reason: a review defect returns the ticket to
Executing; an amended scope or a wrong spec returns it to Planning. Do not skip Planning for anything
that has a ticket, and never leave a ticket in Executing with no live lane behind it — that is the
stop-without-delivery case.

**The reviewer must not be the planner.** The fallback fires often, and the agent after Codex is
Claude, who is also the usual reviewer - which would have one agent judging an implementation against
its own spec. When planner and default reviewer would be the same, move the *review* to the next
agent in the chain, not the planning. If no second agent is available, say so on the ticket and leave
the PR for Jerry; an unreviewed PR that admits it is fine, a self-review presented as review is not.

**Parent tickets.** When planning finishes, children are created in `To Do` and the parent moves to
`Executing` - a container, so it needs no branch of its own. The parent goes to `Done` when the last
child does, and never passes through PR / Code Review. A child returning to Planning leaves the
parent in Executing.

**Blocked is a flag, not a stage.** There is no Blocked column: a blocked ticket keeps its stage and
carries a flag naming the blocker and its owner, because "blocked three-quarters through Executing"
and "blocked before Planning" are different objects. Blocked means paused with intent to resume - if
the lane is gone, that is the stop-without-delivery update instead.

**If you cannot post, relay.** Outside lanes (`codex_auto_dev.sh`, launchd watchdogs, handoff queue
runners, IDE and desktop sessions) have no mechanism to reach the board, so route work that needs
board visibility through the app - and end every outside-lane report with a paste-ready block:

```
TICKET: <id or title>
STAGE:  <stage>  (was: <previous>)
STATE:  <verified state>
PROOF:  <PR link - SHA - gate command and result>
NOT DONE: <what remains, or "nothing">
BLOCKED: <blocker and owner, or "no">
```

**Kangentic injects a per-session MCP server into agents it launches** - it is not a service you
connect to. Verified 2026-09-11: the app listens on `127.0.0.1` at an ephemeral port and gives each
agent it spawns a URL `http://127.0.0.1:<port>/mcp/<projectId>/<sessionId>` plus an
`X-Kangentic-Token` header taken from that process's environment.

So: if your session has `kangentic` MCP tools, Kangentic launched you - the board is live, use them.
If it does not, you were started outside the app and **cannot reach the board**. Do not reconstruct
the endpoint: the port is ephemeral, the session ID is not yours, and the token is in another
process's environment. Instead keep the project's own backlog and handoff board current, and say in
your reply that the ticket was not updated - including the text Jerry can paste.

Board coverage follows dispatch: work started from inside Kangentic updates its ticket, identical
work started from an outside shell cannot. Dispatch through the app when a work item must be visible.