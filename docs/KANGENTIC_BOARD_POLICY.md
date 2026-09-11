# Kangentic Board Policy (All AI Agents)

Last updated: 2026-09-11

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

That is not in tension with the split done during [Planning](#planning): a child ticket is a work
item, carved out deliberately so it can be built and verified on its own. Five tickets because
planning decomposed the feature is right; five tickets because five PRs happened to be opened is not.

## Stages — the board lifecycle

Every ticket moves through these five stages, in this order. The stage is a claim about where the
work actually is, so it may only be advanced on evidence.

| Stage | A ticket is here when | Owner | It leaves when |
|---|---|---|---|
| **To Do** | The request is captured but nobody has analysed it | Whoever filed it | An agent picks it up and begins planning |
| **Planning** | An agent is turning the request into a spec | The planner (Codex by default) | The spec, the acceptance tests and the child tickets exist |
| **Executing** | Implementation is under way on a branch | The implementer lane | The code is complete and the gate is green |
| **PR / Code Review** | A PR exists and is awaiting review or merge | The reviewer | It merges, or it goes back to Executing |
| **Done** | Merged to `main` | — | Terminal |

### Planning

Planning is a real stage with artifacts, not a pause before coding. The planner must:

1. **Analyse the request and the ticket's requirements** against the code as it actually is — cite
   `file:line` evidence, not recollection.
2. **Write a comprehensive spec**: goal, current state, requirements, sequencing, risks, and the
   verification gate. Follow [`SPEC_KIT_POLICY.md`](SPEC_KIT_POLICY.md) — this stage *is*
   `speckit-specify` → `speckit-clarify` → `speckit-plan` → `speckit-tasks`.
3. **Write acceptance tests**: name the test files and cases, and the exact command that proves the
   behaviour. An acceptance criterion a no-op could satisfy is not an acceptance criterion.
4. **Break the work into the smallest independently verifiable child tickets.** This is the point of
   the stage: small pieces run in parallel across lanes, and each one can be checked on its own
   rather than as part of an unreviewable whole.

**Planner assignment — Codex by default.** Fall back down this chain only when the preceding agent is
unavailable or quota-blocked:

```
codex  →  claude  →  ollama / arkcli  →  antigravity  →  gemini
```

Record on the ticket which agent actually planned it. Do not hand-pick a planner to skip the
queue — the routing is what makes the fallback auditable. In Smart-Stock-Picker this chain is
enforced by `scripts/agent_quota.sh route`, whose default `IMPLEMENTER_CHAIN` is
`codex codex-ark antigravity`; extend that variable rather than routing around it.

**The reviewer must not be the planner.** Recording who planned a ticket is what makes this
checkable, and it matters because the fallback fires often — Codex quota-blocks regularly, and the
next agent in the chain is Claude, who is also the usual reviewer. Left alone, that produces an agent
writing the spec and then judging an implementation against its own spec. It will find the
implementation faithful, because it is comparing the work to the same idea it already had; the
failure mode is not dishonesty but a blind spot that is invisible from the inside.

So: when the planner and the default reviewer would be the same agent, move the **review** to the
next available agent in the chain, not the planning. Planning quality benefits from the strongest
available agent; review benefits from a *different* one. If no second agent is available, say so on
the ticket and leave the PR for Jerry — an unreviewed PR that says it is unreviewed is fine, and one
that claims a self-review as review is not.

### Parent and child tickets

Planning splits a parent ticket into child tickets. Each child is then a work item in its own right
with its own lifecycle, and the "one ticket per work item" rule applies to it. **The parent stays
open until every child is Done** — it is a container, and closing it early hides the remainder.

Where the parent sits while that happens:

- When planning finishes, the children are created in **To Do** and the parent moves to
  **Executing**. The parent is a container, so "Executing" means *its children are being built* —
  it does not need a branch of its own.
- The parent goes to **Done** when the last child reaches Done. It does **not** pass through PR /
  Code Review; a container has no PR. Its evidence is the set of child tickets and their merge SHAs.
- If a child is sent back to Planning, the parent stays in Executing. Only an amendment to the
  *parent's own* scope returns the parent to Planning — and then its children are re-derived, not
  quietly edited.

A parent in Executing with every child still in To Do is a real state and an honest one: planning is
done, building has not started. Do not dress it up by moving a child forward.

### Moving backwards

Backward moves are legitimate and must be recorded with a reason:

- Review finds a defect → back to **Executing**.
- Scope is amended, or implementation reveals the spec was wrong → back to **Planning**. Per
  `SPEC_KIT_POLICY.md`, revise the spec explicitly; do not patch around it from Executing.

Do not skip Planning for anything that has a ticket. A ticket sitting in **Executing** with no live
lane behind it is the stop-without-delivery case below, not a ticket in progress.

### Blocked is a flag, not a stage

**There is no Blocked column.** A blocked ticket keeps its stage and carries a blocked flag, because
the stage is information worth keeping: a ticket blocked three-quarters of the way through Executing
is a very different object from one blocked before Planning started, and a Blocked column erases that
distinction. Columns that erase progress become graveyards — work goes in and nobody can tell what it
would take to get it out.

A blocked flag must name the blocker and its owner ("awaiting Jerry's decision on the venue switch",
"Codex quota until Sep 7"). Clear the flag when the blocker clears; the ticket resumes where it was.

The one thing a blocked flag is **not** is a substitute for the stop-without-delivery update. Blocked
means the work is paused and someone intends to resume it. If the lane is gone, say that instead.

## When to sync

Update the ticket at these four moments, and not on every commit:

| Moment | What changes |
|---|---|
| **Start** | Move to Planning or Executing; record the owner (which agent/lane) and the branch |
| **State change** | A stage transition, blocked, handed to another lane, scope amended, decision needed from Jerry |
| **Delivery** | Moved to Done, with the commit SHA and PR link |
| **Stop without delivery** | Abandoned, quota-killed, superseded — say which, and where the work sits |

That last row is the one agents skip. **A lane that dies mid-task must leave the ticket saying so.**
Silence reads as progress.

Two stage transitions are worth calling out because they are the ones most often claimed early:

- **Executing → PR / Code Review** requires the PR to exist. Post its link.
- **PR / Code Review → Done** requires the merge. A draft PR, an approving review and a green gate
  are all still PR / Code Review.

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

## Connecting to Kangentic — the board reaches you, you do not reach it

Kangentic (`/Applications/Kangentic.app`, an Electron developer-tools app) is not a service you
connect *to*. It launches the agent CLI itself and injects a **per-session MCP server** into the
process it spawns. Verified 2026-09-11 against a running instance:

- The app's main process listens on **`127.0.0.1`** at an **ephemeral port** (`mcpServer: {enabled:
  true, bindAddress: "127.0.0.1"}` in its `config.json`).
- Each spawned agent receives a URL of the form `http://127.0.0.1:<port>/mcp/<projectId>/<sessionId>`
  and a header `X-Kangentic-Token`, whose value comes from `KANGENTIC_MCP_TOKEN` in **that process's**
  environment. `<projectId>` is the app's ID for the registered project; `<sessionId>` identifies the
  individual agent session.
- Observed injection, for a Codex lane the app started:
  `codex -c mcp_servers.kangentic.url=... -c mcp_servers.kangentic.env_http_headers.X-Kangentic-Token=KANGENTIC_MCP_TOKEN`

### What this means for you

**Check whether you have `kangentic` MCP tools.**

- **You do** → Kangentic launched you. The board is live; sync the ticket at the four moments above,
  using those tools. This is the normal path.
- **You do not** → you were started outside Kangentic (a terminal, a launchd lane, an IDE, the Claude
  desktop app). **You cannot reach the board, and you must not try to reconstruct the endpoint.** The
  port is ephemeral, `<sessionId>` identifies a session that is not yours, and the token is in another
  process's environment, not yours. A URL assembled from those pieces is a guess, and a guess that
  half-works is worse than none.

In that second case:

- **Do the in-repo half**, which is real and already required: the project's own backlog and handoff
  board (for example `vcp_research/docs/BACKLOG_CONSOLIDATION_DEV_PLAN.md` and
  `HANDOFF_PUNCHLIST.md` in Smart-Stock-Picker). Those stay authoritative.
- **State plainly in your reply** that the ticket was not updated because this session has no
  Kangentic connection, and include the exact text you would have posted so Jerry can paste it.

### Board coverage follows dispatch

Work started **from inside Kangentic** updates its own ticket; identical work started from an outside
shell cannot, however careful or well-intentioned the agent is. This is not a discipline problem and
no amount of policy text fixes it — the outside lane has no mechanism.

Most automation here is structurally outside:

| Lane | Started by | Can post? |
|---|---|---|
| Agent sessions dispatched from the Kangentic app | Kangentic | **Yes** |
| `scripts/codex_auto_dev.sh`, `antigravity_auto_dev.sh` | A shell or the dispatcher | No |
| launchd watchdogs (`pr-watchdog`, `lane-watchdog`) | launchd | No |
| `agent_workflow.sh codex-handoff` queue runners | A shell or a watcher | No |
| IDE and desktop-app sessions (Cursor, Claude desktop) | The editor | No |

Two rules follow.

**1. Route by visibility need.** If a work item must be visible on the board, dispatch it from the
app. Choosing an outside lane for that item is choosing to have no board record of it — a legitimate
choice for a throwaway task, and the wrong one for anything with a ticket.

**2. An outside lane must end its report with a relay block.** It cannot post, but it can make
posting take five seconds instead of five minutes of reconstruction. End the final report with a
fenced block in this shape, so whoever is in the app transfers it verbatim:

```
TICKET: <id or title>
STAGE:  <To Do | Planning | Executing | PR / Code Review | Done>  (was: <previous>)
STATE:  <verified state — what is true right now>
PROOF:  <PR link · SHA · the gate command and its result>
NOT DONE: <what remains, or "nothing">
BLOCKED: <blocker and owner, or "no">
```

The relay is the whole mitigation. An outside lane that finishes silently leaves a ticket that reads
as in-progress forever; one that finishes with a relay block leaves a ticket that is one paste from
correct.

### Open question — a stable endpoint for outside lanes

Whether the app can expose a **stable, project-scoped** endpoint (or a CLI) that outside lanes could
post to is unresolved, and deliberately not guessed at here. If it can, rule 2 above becomes a real
integration and this policy becomes mechanically enforceable rather than advisory. If it cannot, the
relay block is the ceiling and routing by visibility need is the only real control.

Owner: Jerry. Until it is answered, treat the relay block as the required behaviour.

## Ownership

The agent that owns the work owns its ticket. When work is handed to another lane, the handing agent
records the handoff before the new lane starts; the receiving lane owns it from there. A reviewing
agent does not silently re-own a ticket — it comments and hands back.
