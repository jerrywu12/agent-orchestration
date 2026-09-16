# Feature Specification: Background AI agent activity tracking

**Feature Branch**: `claude/ai-agent-activity-tracking-47d573`

**Created**: 2026-09-15

**Status**: Draft

**Input**: User description: "Agent Desk background AI agent activity tracking — replace the SwiftBar codex-status menu bar plugin. Agent Desk must show, for the Mac it runs on, which AI agent work is actively in flight right now: active Codex task lifecycles (from the Codex state DB threads table plus the last task_started/task_complete lifecycle marker in each thread's rollout file, exposing source class, title, workspace basename and short thread id), running Claude Code / Gemini CLI / Antigravity CLI worker processes with elapsed runtime, and Codex-linked sleep-prevention (caffeinate) status, plus a single glanceable active-count with state colour. Today tools/agent-desk/server/machine-inventory.mjs probeMachine only reports whether an installed agent binary has a live process with CPU/RSS; it has no task lifecycle, no elapsed time and no caffeinate signal. This supersedes /Users/jerry/.swiftbar/codex-status.5s.sh, which is to be retired from this Mac after the feature ships and is verified."

## Problem

The administrator currently learns "is any AI agent actually working right now?" from a menu bar indicator that is separate from Agent Desk, undiscoverable from any other device, and maintained as a single untested shell script. Agent Desk already answers a weaker question — *is an agent binary resident in memory* — which cannot distinguish an idle interactive session that has been open for six hours from a subagent that is mid-task. Retiring the menu bar indicator without closing that gap would remove the only reliable "work is in flight" signal on this machine.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See what agent work is in flight right now (Priority: P1)

The administrator opens Agent Desk and, without drilling into any ticket, sees a single count of AI agent work currently in flight on this Mac, and a list of exactly what that count is made of: each actively-working Codex task with its origin, what it is working on, and which workspace; and each standalone Claude Code, Gemini CLI or Antigravity CLI worker with how long it has been running.

**Why this priority**: This is the whole reason the menu bar indicator exists. Without it the indicator cannot be retired, and the count alone (without the breakdown) is not actionable — the administrator needs to know *which* work to leave alone.

**Independent Test**: Seed a fixture activity source containing a mix of working, finished and never-started task records plus a fixture process list, request the activity snapshot, and assert the count and each row's origin, description, workspace and elapsed runtime. Delivers the full "what is running" answer on its own, with no dependency on the sleep-prevention story.

**Acceptance Scenarios**:

1. **Given** a Codex task whose most recent lifecycle marker is "started", **When** the administrator views activity, **Then** that task appears as active with its origin class, short description, workspace name and a short task identifier.
2. **Given** a Codex task whose most recent lifecycle marker is "complete", **When** the administrator views activity, **Then** that task does not appear and does not contribute to the count.
3. **Given** a Codex task record that has never emitted any lifecycle marker, **When** the administrator views activity, **Then** that task does not appear and does not contribute to the count.
4. **Given** a running standalone Claude Code worker, **When** the administrator views activity, **Then** it appears with a stable identifier and an elapsed runtime that increases across successive observations.
5. **Given** the desktop application for an agent is open but no worker is doing background work, **When** the administrator views activity, **Then** the desktop application is not counted as active work.
6. **Given** no agent work is in flight anywhere, **When** the administrator views activity, **Then** the count reads zero and the view states that nothing is active — visibly distinct from being unable to observe.
7. **Given** activity is being observed, **When** an existing ticket, stage, execution claim or agent capacity view is inspected, **Then** none of them are altered by the observation.

---

### User Story 2 - Know whether the Mac is being held awake for agent work (Priority: P2)

The administrator can see whether sleep prevention tied to agent work is currently in force, and which workers are holding it, so an overnight run is not lost to the machine sleeping and a forgotten hold is not left draining power.

**Why this priority**: Genuinely useful and part of the retired indicator's behaviour, but the activity list is independently valuable without it; this story can ship second.

**Independent Test**: Provide a fixture process list with and without an agent-linked sleep-prevention wrapper and assert the reported state and holder list. Testable with no Codex task source present at all.

**Acceptance Scenarios**:

1. **Given** one or more agent-linked sleep-prevention holds are active, **When** the administrator views activity, **Then** sleep prevention reads active and each holder is listed with its elapsed runtime.
2. **Given** no agent-linked sleep-prevention hold exists, **When** the administrator views activity, **Then** sleep prevention reads inactive.
3. **Given** a sleep-prevention hold exists that is not linked to agent work, **When** the administrator views activity, **Then** it is not reported as an agent-linked hold.

---

### User Story 3 - Retire the menu bar indicator with evidence (Priority: P3)

Before the standalone menu bar indicator is removed from this Mac, the administrator can compare what Agent Desk reports against what the indicator reports over the same moment and confirm the same work is represented.

**Why this priority**: This is the decommissioning gate, not new capability. It depends on Stories 1 and 2 existing, so it is last — but it is mandatory before removal.

**Independent Test**: With both signals available at the same moment, capture each and compare the active set. No new product surface is required to run this comparison.

**Acceptance Scenarios**:

1. **Given** both the indicator and Agent Desk are observing the same Mac at the same moment, **When** both are read, **Then** the same set of active work is represented by both.
2. **Given** parity has been confirmed and recorded, **When** the indicator is removed from the Mac, **Then** Agent Desk continues to report activity unchanged and the removal is reversible from recorded evidence.

---

### Edge Cases

- **The activity source is absent, renamed or a newer schema generation.** The task source location is generation-stamped and will change when the upstream agent upgrades. Activity must report "cannot observe" with a plain reason rather than silently reporting zero active work, and process-based activity must still be reported.
- **The activity source is being written while it is read.** The source is actively written by another application and may be locked or mid-transaction. Observation must be strictly read-only, must never block the writing application, must give up quickly, and must never create, migrate or repair the source.
- **A task's lifecycle history file is missing, unreadable, empty or very large.** Lifecycle history files reach hundreds of megabytes. Determining the latest lifecycle marker must be bounded in bytes and time, and an unreadable history must exclude that task rather than fail the whole snapshot.
- **A task's origin is a structured value rather than a simple label**, including nested subagent spawn records. Origin classification must degrade to a safe generic label instead of leaking the raw structure.
- **A task carries no description, or a description containing tabs, newlines or control characters.** Descriptions must be normalized to a single bounded line, with a neutral placeholder when absent.
- **An agent ships both a desktop application and a command-line worker under similar names**, and integrated development environments bundle helper processes that share an agent's name. These must not be counted as background agent work.
- **Process metadata is unavailable or truncated on this host.** Activity must degrade to "cannot observe" for the process-based portion while still reporting task-based activity, and must say coverage is partial.
- **Agent Desk is running in a container rather than directly on the Mac.** Host activity cannot be observed from inside a container; the view must say so rather than report zero.
- **The same work is visible through both a task record and a process.** It must be counted once, not twice.
- **Observation takes longer than its own refresh interval.** Overlapping observations must coalesce, and the previous successful snapshot must be retained and marked stale rather than replaced with an error.

## Requirements *(mandatory)*

### Functional Requirements

**Activity snapshot**

- **FR-001**: The system MUST report, for the machine it runs on, a bounded snapshot of AI agent work currently in flight, comprising active task records, active worker processes, a sleep-prevention state, an observation time, and an overall observability state.
- **FR-002**: The system MUST report a single active-work count equal to the number of distinct active items, and MUST expose an accompanying state that distinguishes at minimum: active work present, no active work, and activity cannot be observed.
- **FR-003**: The system MUST treat a task as active only when its most recent lifecycle marker indicates work has started and has not since completed. A task with no lifecycle marker MUST NOT be reported as active.
- **FR-004**: The system MUST report, for each active task: an origin class, a normalized single-line description, the workspace's final path segment, and a shortened task identifier.
- **FR-005**: The system MUST classify task origin into a fixed, closed set of human-readable classes and MUST map any unrecognized or structured origin value to a generic class without exposing the underlying value.
- **FR-006**: The system MUST report, for each active worker process, the agent it belongs to, a process identifier, and elapsed runtime.
- **FR-007**: The system MUST distinguish background command-line workers from desktop applications and from development-environment helper processes belonging to the same agent, and MUST exclude the latter two from active work.
- **FR-008**: The system MUST report whether sleep prevention linked to agent work is currently in force, and when in force MUST list each holding process with its elapsed runtime.
- **FR-009**: The system MUST count each distinct unit of work once when it is observable through more than one signal.
- **FR-010**: Users MUST be able to request an immediate activity refresh, and the system MUST refresh automatically on a bounded recurring interval without user action.

**Degradation and integrity**

- **FR-011**: The system MUST report each activity source's observability independently, so that the failure of one source degrades only its own portion of the snapshot and is stated as partial coverage rather than absence of work.
- **FR-012**: The system MUST retain the last successful snapshot when a refresh fails or times out, and MUST mark the retained snapshot stale with the reason expressed in the system's own fixed wording.
- **FR-013**: The system MUST coalesce overlapping refreshes so that a slow observation cannot queue additional observations or make the interface unresponsive.
- **FR-014**: The system MUST bound every observation in time, in bytes read, and in the number of reported items, and MUST state when results were truncated.
- **FR-015**: The system MUST NOT create, modify, migrate, repair, lock or delete any activity source, and MUST NOT start, stop, signal or otherwise affect any observed process or agent.
- **FR-016**: The system MUST NOT alter tickets, stages, execution claims, session ownership, agent capacity records or any other existing state as a consequence of observing activity.
- **FR-017**: The system MUST state when it cannot observe host activity because it is not running directly on the host being asked about.

**Privacy and access**

- **FR-018**: Activity observations MUST be session-local and memory-only. They MUST NOT be written to durable storage, ticket history, the synchronization outbox, exported reports, logs or version control.
- **FR-019**: The system MUST NOT expose prompts, transcripts, message content, full command arguments, environment variables, credentials, absolute filesystem paths or account identity through activity reporting. Task descriptions MUST be bounded in length and stripped of control characters, and workspace identification MUST be limited to the final path segment.
- **FR-020**: Activity reporting MUST require existing administrator access. Scoped agent credentials and unauthenticated users MUST NOT be able to read it.

**Decommissioning**

- **FR-021**: The system MUST represent the same set of active work that the superseded menu bar indicator represents for the same machine at the same moment, for task activity, worker activity and sleep prevention.
- **FR-022**: Removal of the superseded indicator MUST be a separate, explicitly authorized machine-local step performed after parity is confirmed, and MUST be reversible from recorded evidence.

### Key Entities

- **Activity snapshot**: The complete answer to "what agent work is in flight on this machine now" — the active count and state, the active task list, the active worker list, sleep-prevention state, per-source observability, observation time and staleness. Memory-only and replaced wholesale on each successful observation.
- **Active task**: A unit of agent work observed to have started and not finished, described by origin class, normalized description, workspace segment, shortened identifier and the agent it belongs to.
- **Active worker**: A background agent process observed to be running, described by owning agent, process identifier and elapsed runtime. Excludes desktop applications and development-environment helpers.
- **Sleep-prevention state**: Whether agent-linked sleep prevention is in force, and the holding processes with their elapsed runtimes.
- **Source observability**: Per activity source, whether it was observed successfully, and if not, a fixed-wording reason and whether prior values were retained.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The administrator can determine whether any AI agent work is in flight on this Mac, and what that work is, from Agent Desk alone — without the menu bar indicator, a terminal, or opening any agent application.
- **SC-002**: For a seeded mix of started, completed and never-started task records, the reported active set matches the expected set exactly, with no false positives and no omissions.
- **SC-003**: Desktop applications and development-environment helper processes belonging to a tracked agent are never reported as active background work, verified against a seeded process list containing each of those look-alikes.
- **SC-004**: Activity reflects a change in the underlying state within one refresh interval of that change, with the refresh interval no longer than 30 seconds.
- **SC-005**: When an activity source is unavailable, the administrator sees an explicit "cannot observe" state naming the affected source, and never a zero count implying no work; verified for a missing source, an unreadable source and unavailable process metadata.
- **SC-006**: Requesting activity returns within 3 seconds under normal conditions, and a slow or failed observation never leaves the interface unresponsive or replaces good data with an error.
- **SC-007**: No prompt text, transcript content, full command arguments, credentials, environment values, account identity or absolute path appears anywhere in activity output, verified by inspecting the reported payload.
- **SC-008**: Activity data does not appear in durable storage, ticket history, the synchronization outbox or version control after a full session including refreshes and restarts.
- **SC-009**: A scoped agent credential and an unauthenticated request are both refused access to activity reporting.
- **SC-010**: Agent Desk and the menu bar indicator, read at the same moment on the same Mac, represent the same active work set — the recorded evidence that authorizes removing the indicator.
- **SC-011**: All existing Agent Desk journeys — ticket lists, stages, claims, machine inventory, agent capacity and integration flows — remain green after the change.

## Boundaries

**In scope**: Read-only observation of agent activity on the machine running Agent Desk; a glanceable count with state; the active task and worker breakdown; agent-linked sleep-prevention state; graceful degradation and partial coverage reporting; parity evidence against the superseded indicator; and, as a separate authorized step, that indicator's removal.

**Out of scope**: Starting, stopping, pausing or signalling any agent or process; managing sleep prevention rather than reporting it; historical activity retention, trends or charts; notifications and alerting; observing machines other than the one Agent Desk runs on; attributing observed activity to Agent Desk tickets or executions; changing quota and capacity reporting; and any change to how tickets, stages or claims behave.

**Always preserved**: Existing agents, sessions, credentials, installed applications, activity sources and unrelated repository work. Observation never writes to another application's data. Existing machine inventory and agent capacity behaviour is unchanged; this feature is additive.

## Assumptions

- **A-001**: "Background AI agent activity" means work in flight now. Historical or completed activity is out of scope, and no activity history is retained.
- **A-002**: The audience is the single administrator of this Mac. No multi-user, multi-machine or fleet aggregation is required.
- **A-003**: Activity lives alongside the existing machine observation surface, since it answers an adjacent question about the same host, and reuses that surface's established refresh, staleness, coalescing and degradation behaviour rather than inventing new patterns.
- **A-004**: A refresh interval in line with the existing runtime observation cadence is acceptable; strict real-time streaming is not required.
- **A-005**: The set of tracked agents is the set already recognized by Agent Desk's machine observation. Agents that Agent Desk does not already recognize are out of scope for this feature.
- **A-006**: Task-level lifecycle detail is available only for agents that expose an observable task source. For other agents, process-level activity with elapsed runtime is the expected and sufficient level of detail.
- **A-007**: Task descriptions originate from user input and are therefore treated as sensitive: bounded, normalized, session-local, administrator-only and never persisted.
- **A-008**: The upstream task source format is not a stable contract and may change without notice. Unrecognized shape is treated as "cannot observe", never as zero active work, and never as a reason to modify the source.
- **A-009**: The superseded indicator remains installed and operating until parity is recorded, so that the machine is never without an activity signal.

## Dependencies

- **D-001**: Requires Agent Desk's existing administrator access control.
- **D-002**: Requires Agent Desk's existing machine observation surface, including its agent recognition, refresh scheduling and degradation behaviour.
- **D-003**: Requires read access to the Mac's process metadata and to the Codex task source, both owned by other software and read strictly read-only.
- **D-004**: Story 3 requires the superseded indicator to still be installed at verification time.

---

## Addendum: User Story 4 — Keep the Mac awake for agent work, but let the screen lock (Priority: P1)

**Added 2026-09-16.** Feature 011 originally *observed* sleep prevention held by an external tool. That tool — a standalone LaunchAgent carrying its own hardcoded agent list — was retired on 2026-09-15, leaving nothing holding the machine awake. Agent Desk already performs the detection, so it now owns the hold too: one list to keep correct instead of two that drift.

The administrator can leave a long agent run unattended. The Mac stays awake so work continues, while the display still sleeps and the screen still locks on its normal schedule.

**Why this priority**: without it, an unattended overnight run is interrupted by system sleep. Holding the display on instead would leave the machine unlocked, which is not an acceptable trade.

**Independent Test**: drive the coordinator with fixture snapshots and an injected spawn; assert when a hold is taken, when it is released, and that the display is never held.

**Acceptance Scenarios**

1. **Given** agent work is in flight, **When** the machine would otherwise idle-sleep, **Then** system sleep is prevented and the work continues.
2. **Given** a hold is in force, **When** the display idle timeout elapses, **Then** the display sleeps and the screen locks as normal.
3. **Given** the last agent work finishes, **When** the next observation runs, **Then** the hold is released and normal power behaviour resumes.
4. **Given** only helper daemons are running (an MCP server, a model runtime), **When** keep-awake is evaluated, **Then** no hold is taken — a helper that is merely alive is not work in flight.
5. **Given** activity cannot be observed, or the last observation is stale, **When** keep-awake is evaluated, **Then** no hold is taken. Uncertainty resolves toward normal power behaviour, never toward holding the machine awake.
6. **Given** Agent Desk is holding an assertion, **When** activity is reported, **Then** its own hold appears as an observed holder, so the decision and the observation agree.
7. **Given** the server stops by any route, including a `SIGTERM` from `launchd`, **When** it exits, **Then** the assertion is released and no holder is orphaned.

### Requirements

- **FR-023**: The system MUST prevent idle system sleep while agent work is in flight, and MUST NOT prevent display sleep. Screen locking must remain governed by the machine's own settings.
- **FR-024**: Keep-awake MUST count only agents that represent work in flight. A helper daemon spawned by, or serving, another agent MUST NOT justify a hold.
- **FR-025**: A hold MUST NOT be taken or extended on an observation older than a bounded staleness window, and a single continuous hold MUST be bounded.
- **FR-026**: The assertion MUST be released when work ends, when keep-awake is disabled, and when the server exits by any route.
- **FR-027**: The system MUST report its own hold as an observed holder, and MUST report the keep-awake decision separately from the observation of holds on the machine.
- **FR-028**: Keep-awake MUST be disableable without disabling activity observation.

### Success Criteria

- **SC-012**: An unattended agent run survives the system idle-sleep timeout, and the screen is locked when the administrator returns.
- **SC-013**: With only helper daemons running, no hold is taken — verified against the live composition that motivated this, where Hermes MCP servers outnumbered real workers.
- **SC-014**: No assertion outlives the server process, verified by stopping it with `SIGTERM`.
- **SC-015**: The reported keep-awake holder and the reported observed holder agree.

### Assumptions

- **A-010**: Screen locking is already configured on the machine (display sleep plus a password requirement). Keep-awake does not configure it and must never weaken it.
- **A-011**: Preventing system sleep is sufficient for unattended work. Preventing disk or network sleep is out of scope.
