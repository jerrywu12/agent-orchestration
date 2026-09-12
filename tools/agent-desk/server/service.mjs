import { Attachments } from "./attachments.mjs";
import { EventEmitter } from "node:events";
import { fail, id, now } from "./store.mjs";
import { ensureProjectWorkflow, migrateWorkflow } from "./workflow.mjs";
const priorities = ["urgent", "high", "medium", "low", "none"];
const text = (v, name, max = 500) => {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    fail(
      422,
      "VALIDATION",
      `${name} is required and must be at most ${max} characters.`,
    );
  return v.trim();
};
const strings = (v, name) => {
  if (
    !Array.isArray(v) ||
    v.length > 100 ||
    v.some((x) => typeof x !== "string" || !x || x.length > 200)
  )
    fail(422, "VALIDATION", `${name} must be a list of short strings.`);
  return [...new Set(v)];
};
const agentDefaults = [
  ["codex", "Codex", "#2c8069", "codex"],
  ["claude", "Claude", "#bc7457", "claude"],
  ["gemini", "Gemini", "#538ace", "gemini"],
  ["cursor", "Cursor", "#515761", "cursor"],
  ["antigravity", "Antigravity", "#8d69b5", "external"],
  ["hermes", "Hermes", "#b09251", "external"],
  ["ollama", "Ollama", "#687586", "external"],
  ["arkcli", "ArkCLI", "#b86d74", "external"],
];
export class Service extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.attachments = new Attachments(store);
    migrateWorkflow(store);
    for (const [agentId, name, color, adapter] of agentDefaults)
      if (!store.get("agent", agentId))
        store.put("agent", {
          id: agentId,
          name,
          color,
          adapter,
          enabled: true,
          capabilities: { execute: adapter !== "external", report: true },
        });
  }
  require(kind, key) {
    return (
      this.store.get(kind, key) ?? fail(404, "NOT_FOUND", `${kind} not found.`)
    );
  }
  changed() {
    this.emit("change");
  }
  state() {
    return {
      projects: this.store.list("project"),
      stages: this.store.list("stage").sort((a, b) => a.position - b.position),
      agents: this.store.list("agent"),
      tickets: this.store.list("ticket").map((t) => this.decorate(t)),
      activity: this.store.activities(),
      sync: this.store.list("sync"),
      capabilities: { localMode: true },
      serverTime: now(),
    };
  }
  decorate(ticket) {
    return {
      ...ticket,
      attachments: this.attachments.list(ticket.id),
      execution: this.store.latest(ticket.id),
    };
  }
  getTicket(key) {
    return {
      ...this.decorate(this.require("ticket", key)),
      attachmentContext: this.attachments.list(key, true),
    };
  }
  createProject(input) {
    return this.store.transaction(() => {
      if (input.id !== undefined) {
        text(input.id, "Project ID", 200);
        if (this.store.get("project", input.id))
          fail(409, "ALREADY_EXISTS", "Project already exists.");
      }
      const name = text(input.name, "Project name", 100);
      const key = text(
        input.key ??
          (name
            .replace(/[^a-zA-Z]/g, "")
            .slice(0, 4)
            .toUpperCase() ||
            "WORK"),
        "Project key",
        12,
      ).toUpperCase();
      if (!/^[A-Z][A-Z0-9_-]*$/.test(key))
        fail(422, "VALIDATION", "Project key must begin with a letter.");
      const p = this.store.put("project", {
        id: input.id ?? id(),
        name,
        key,
        path: "",
        repo: "",
        createdAt: now(),
        ...this.projectFields(input),
      });
      ensureProjectWorkflow(this.store, p.id);
      this.changed();
      return p;
    });
  }
  projectFields(input) {
    const fields = {};
    if (
      [
        "stageMapping",
        "statusFieldId",
        "statusOptions",
        "githubProjectId",
      ].some((k) => input[k] !== undefined)
    )
      fail(
        422,
        "READ_ONLY_WORKFLOW",
        "GitHub status fields are discovered automatically from the project.",
      );
    for (const k of ["name", "path", "repo"])
      if (input[k] !== undefined) {
        if (typeof input[k] !== "string" || input[k].length > 1000)
          fail(422, "VALIDATION", `Invalid ${k}.`);
        fields[k] = input[k].trim();
      }
    if (fields.repo && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fields.repo))
      fail(422, "VALIDATION", "Repository must be owner/name.");
    if (input.githubProjectNumber !== undefined) {
      if (
        input.githubProjectNumber !== null &&
        (!Number.isSafeInteger(input.githubProjectNumber) ||
          input.githubProjectNumber < 1)
      )
        fail(422, "VALIDATION", "Project number must be positive.");
      fields.githubProjectNumber = input.githubProjectNumber;
    }
    return fields;
  }
  updateProject(key, input) {
    const p = this.require("project", key);
    const fields = this.projectFields(input);
    if (
      fields.repo !== undefined &&
      fields.repo !== p.repo &&
      (this.store.get("project-sync-intent", key) ||
        this.store
          .list("ticket", key)
          .some(
            (t) => t.github?.number || this.store.get("publish-intent", t.id),
          ))
    )
      fail(
        409,
        "LINKED_REPOSITORY",
        "This project has linked GitHub issues. Create a separate project to connect another repository.",
      );
    const next = this.store.put("project", {
      ...p,
      ...fields,
      updatedAt: now(),
    });
    this.changed();
    return next;
  }
  createStage() {
    fail(
      409,
      "FIXED_WORKFLOW",
      "Projects use Backlog, Ready, In progress, In review and Done.",
    );
  }
  updateStage() {
    fail(409, "FIXED_WORKFLOW", "The GitHub workflow stages are fixed.");
  }
  deleteStage() {
    fail(409, "FIXED_WORKFLOW", "The GitHub workflow stages are fixed.");
  }
  normalizeBrief(value = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      fail(422, "BRIEF", "Task brief must be an object.");
    const brief = {};
    for (const key of ["acceptanceCriteria", "scope", "verification"]) {
      const part = value[key] ?? "";
      if (typeof part !== "string" || part.length > 10000)
        fail(
          422,
          "BRIEF",
          `Task brief ${key} must be text under 10000 characters.`,
        );
      brief[key] = part;
    }
    return brief;
  }
  validateTicket(ticket) {
    if (ticket.brief !== undefined) this.normalizeBrief(ticket.brief);
    text(ticket.title, "Title", 500);
    if (
      typeof ticket.description !== "string" ||
      ticket.description.length > 100000
    )
      fail(
        422,
        "VALIDATION",
        "Description must be text under 100000 characters.",
      );
    const stage = this.require("stage", ticket.stageId);
    if (stage.projectId !== ticket.projectId)
      fail(422, "PROJECT_MISMATCH", "Stage belongs to another project.");
    if (!priorities.includes(ticket.priority))
      fail(422, "VALIDATION", "Invalid priority.");
    if (ticket.ownerId) this.require("agent", ticket.ownerId);
    strings(ticket.labels, "Labels");
    strings(ticket.dependsOn, "Dependencies");
    if (
      typeof ticket.blockedReason !== "string" ||
      ticket.blockedReason.length > 2000
    )
      fail(422, "VALIDATION", "Invalid blocker.");
    if (typeof ticket.archived !== "boolean")
      fail(422, "VALIDATION", "Archived must be a boolean.");
    const visit = (key, seen = new Set()) => {
      if (key === ticket.id)
        fail(422, "DEPENDENCY_CYCLE", "Dependency cycle detected.");
      if (seen.has(key)) return;
      seen.add(key);
      const dep = this.require("ticket", key);
      for (const next of dep.dependsOn ?? []) visit(next, seen);
    };
    for (const dep of ticket.dependsOn) visit(dep);
    if (ticket.parentId) {
      let parent = this.require("ticket", ticket.parentId);
      const seen = new Set([ticket.id]);
      while (parent) {
        if (seen.has(parent.id))
          fail(422, "PARENT_CYCLE", "Parent cycle detected.");
        seen.add(parent.id);
        if (parent.projectId !== ticket.projectId)
          fail(422, "PROJECT_MISMATCH", "Parent belongs to another project.");
        parent = parent.parentId
          ? this.require("ticket", parent.parentId)
          : null;
      }
    }
    if (stage.role === "done") {
      const children = this.store
        .list("ticket")
        .filter((t) => t.parentId === ticket.id);
      if (
        children.some((c) => this.require("stage", c.stageId).role !== "done")
      )
        fail(409, "CHILDREN_PENDING", "All child tickets must be done first.");
      if (this.store.active(ticket.id))
        fail(
          409,
          "ACTIVE_EXECUTION",
          "Checkpoint or finish execution before marking done.",
        );
    }
  }
  createTicket(input) {
    return this.store.transaction(() => {
      if (input.id !== undefined) {
        text(input.id, "Ticket ID", 200);
        if (this.store.get("ticket", input.id))
          fail(409, "ALREADY_EXISTS", "Ticket already exists.");
      }
      this.require("project", input.projectId);
      const stages = this.store
        .list("stage", input.projectId)
        .sort((a, b) => a.position - b.position);
      const value = {
        id: input.id ?? id(),
        projectId: input.projectId,
        number:
          Math.max(
            0,
            ...this.store
              .list("ticket", input.projectId)
              .map((t) => t.number ?? 0),
          ) + 1,
        title: text(input.title, "Title"),
        description: input.description ?? "",
        brief: this.normalizeBrief(input.brief),
        stageId: input.stageId ?? stages[0]?.id,
        ownerId: input.ownerId ?? null,
        priority: input.priority ?? "none",
        labels: input.labels ?? [],
        parentId: input.parentId ?? null,
        dependsOn: input.dependsOn ?? [],
        blockedReason: input.blockedReason ?? "",
        archived: false,
        createdAt: now(),
        updatedAt: now(),
        github: null,
      };
      this.validateTicket(value);
      const result = this.store.put("ticket", value);
      this.attachments.bind(input.attachmentIds ?? [], result.id);
      this.store.activity(value.id, "created", "Ticket created", value.ownerId);
      this.changed();
      return this.decorate(result);
    });
  }
  updateTicket(key, input) {
    return this.store.transaction(() => {
      const previous = this.require("ticket", key);
      if (!Number.isSafeInteger(input.version))
        fail(422, "VERSION_REQUIRED", "Provide the ticket version.");
      if (input.version !== previous.version)
        fail(
          409,
          "VERSION_CONFLICT",
          "This ticket changed. Reload before saving.",
        );
      const next = { ...previous };
      for (const k of [
        "title",
        "description",
        "brief",
        "stageId",
        "ownerId",
        "priority",
        "labels",
        "parentId",
        "dependsOn",
        "blockedReason",
        "archived",
      ])
        if (input[k] !== undefined) next[k] = input[k];
      if (next.ownerId !== previous.ownerId && this.store.active(key))
        fail(
          409,
          "HANDOFF_REQUIRED",
          "Checkpoint and handoff the active execution before changing owner.",
        );
      if (next.archived && this.store.active(key))
        fail(
          409,
          "ACTIVE_EXECUTION",
          "Checkpoint active execution before archiving.",
        );
      if (input.brief !== undefined)
        next.brief = this.normalizeBrief(input.brief);
      this.validateTicket(next);
      next.title = next.title.trim();
      next.updatedAt = now();
      if (next.github) {
        next.github = { ...next.github, dirty: true, syncState: "pending" };
        this.store.enqueue(key);
      }
      const result = this.store.put("ticket", next, input.version);
      const changes = [
        "title",
        "stageId",
        "ownerId",
        "priority",
        "blockedReason",
        "archived",
      ].filter((k) => next[k] !== previous[k]);
      this.store.activity(
        key,
        "updated",
        changes.length
          ? `Updated ${changes.map((k) => ({ stageId: "stage", ownerId: "owner", blockedReason: "blocker" })[k] ?? k).join(", ")}`
          : "Ticket details updated",
      );
      this.changed();
      if (
        next.stageId !== previous.stageId &&
        this.require("stage", next.stageId).autoStart
      )
        this.emit("autostart", key);
      return this.decorate(result);
    });
  }
  ready(key, agentId, { resolveBlockers = false } = {}) {
    const ticket = this.require("ticket", key);
    if (!ticket.ownerId || ticket.ownerId !== agentId)
      fail(
        403,
        "OWNER_MISMATCH",
        "Only the assigned agent may claim this ticket.",
      );
    const agent = this.require("agent", agentId);
    if (!agent.enabled) fail(422, "AGENT_DISABLED", "This agent is disabled.");
    if (ticket.archived) fail(409, "ARCHIVED", "Archived work cannot start.");
    const stage = this.require("stage", ticket.stageId);
    if (stage.role === "done")
      fail(
        409,
        "STAGE_HOLD",
        "Completed work cannot start. Reopen the ticket first.",
      );
    if (resolveBlockers) return ticket;
    if (ticket.blockedReason)
      fail(409, "BLOCKED", `Ticket is blocked: ${ticket.blockedReason}`);
    if (
      ["backlog", "done"].includes(this.require("stage", ticket.stageId).role)
    )
      fail(
        409,
        "STAGE_HOLD",
        "Move the ticket into an active stage before starting.",
      );
    for (const dep of ticket.dependsOn ?? [])
      if (
        this.require("stage", this.require("ticket", dep).stageId).role !==
        "done"
      )
        fail(409, "DEPENDENCY_HOLD", "A dependency is unfinished.");
    return ticket;
  }
  claim(key, input, { resolveBlockers = false } = {}) {
    return this.store.transaction(() => {
      const ticket = this.ready(key, input.agentId, { resolveBlockers });
      const sessionId = text(input.sessionId, "Session ID", 300);
      const existing = this.store.active(key);
      if (existing) {
        if (
          existing.agentId === input.agentId &&
          existing.sessionId === sessionId
        )
          return existing;
        fail(
          409,
          "ALREADY_CLAIMED",
          "Another execution owns this ticket; checkpointed handoff required.",
        );
      }
      const execution = this.store.saveExecution({
        id: id(),
        ticketId: key,
        purpose: resolveBlockers ? "resolve_blockers" : "implementation",
        agentId: input.agentId,
        sessionId,
        state: input.external ? "external" : "running",
        lastSeq: 0,
        progress: null,
        summary: input.external
          ? "Imported session; progress unverified"
          : "Execution started",
        heartbeatAt: now(),
        startedAt: now(),
        branch: input.branch ?? null,
        worktreePath: input.worktreePath ?? null,
        external: !!input.external,
        releasedAt: null,
      });
      this.store.activity(
        key,
        "claimed",
        `Execution claimed by ${input.agentId}`,
        input.agentId,
      );
      this.changed();
      return execution;
    });
  }
  resolutionNeeded(ticket) {
    return (
      !!ticket.blockedReason ||
      this.require("stage", ticket.stageId).role === "backlog" ||
      (ticket.dependsOn ?? []).some(
        (key) =>
          this.require("stage", this.require("ticket", key).stageId).role !==
          "done",
      )
    );
  }
  requireOwnedExecution(key, input) {
    const ticket = this.require("ticket", key);
    const execution = this.store.active(key);
    if (!ticket.ownerId || ticket.ownerId !== input.agentId)
      fail(403, "OWNER_MISMATCH", "This ticket is not assigned to your agent.");
    if (
      !execution ||
      execution.id !== input.executionId ||
      execution.agentId !== input.agentId ||
      execution.sessionId !== input.sessionId
    )
      fail(
        403,
        "SESSION_MISMATCH",
        "An active matching execution and session are required.",
      );
    if (ticket.archived || !this.require("agent", input.agentId).enabled)
      fail(
        409,
        "EXECUTION_HOLD",
        "Archived work or disabled agents cannot organize tickets.",
      );
    if ((execution.heldSessions ?? []).some((session) => !session.releasedAt))
      fail(
        409,
        "HELD_SESSIONS",
        "Reconcile held source sessions before reorganizing this ticket.",
      );
    return { ticket, execution };
  }
  resolutionContext(key, input) {
    const { ticket } = this.requireOwnedExecution(key, input);
    const describe = (candidate) => {
      const active = this.store.active(candidate.id);
      return {
        id: candidate.id,
        number: candidate.number,
        title: candidate.title,
        stage: this.require("stage", candidate.stageId).name,
        ownerId: candidate.ownerId,
        blockedReason: candidate.blockedReason,
        dependsOn: candidate.dependsOn,
        parentId: candidate.parentId,
        archived: candidate.archived,
        execution: active
          ? { agentId: active.agentId, state: active.state, reserved: true }
          : null,
      };
    };
    const peers = this.store.list("ticket", ticket.projectId);
    return {
      ticket: describe(ticket),
      dependencies: (ticket.dependsOn ?? []).map((id) => {
        const dep = this.require("ticket", id);
        return dep.projectId === ticket.projectId
          ? describe(dep)
          : {
              id,
              unavailable: true,
              message:
                "Dependency belongs to another project; request a handoff.",
            };
      }),
      children: peers
        .filter((t) => t.parentId === key)
        .slice(0, 100)
        .map(describe),
      candidates: peers
        .filter((t) => t.id !== key && !t.archived)
        .slice(0, 100)
        .map(describe),
      candidatesTruncated:
        peers.filter((t) => t.id !== key && !t.archived).length > 100,
    };
  }
  agentUpdate(key, input) {
    return this.store.transaction(() => {
      const { ticket } = this.requireOwnedExecution(key, input);
      const reason = text(
        input.reason,
        "Evidence or reorganization reason",
        2000,
      );
      const changes = input.changes;
      const allowed = [
        "title",
        "description",
        "brief",
        "stageId",
        "blockedReason",
        "parentId",
        "dependsOn",
      ];
      if (
        !changes ||
        typeof changes !== "object" ||
        Array.isArray(changes) ||
        !Object.keys(changes).length ||
        Object.keys(changes).some((k) => !allowed.includes(k))
      )
        fail(
          422,
          "AGENT_FIELDS",
          "Only task content, blockers, dependencies, parent and unfinished stages can be updated.",
        );
      if (
        changes.stageId &&
        this.require("stage", changes.stageId).role === "done"
      )
        fail(
          403,
          "REVIEW_REQUIRED",
          "Report completion for review; agents cannot mark work Done.",
        );
      if (changes.dependsOn !== undefined) {
        strings(changes.dependsOn, "Dependencies");
        for (const id of changes.dependsOn)
          if (this.require("ticket", id).projectId !== ticket.projectId)
            fail(
              422,
              "PROJECT_MISMATCH",
              "Agent dependency changes must remain in this project.",
            );
      }
      const result = this.updateTicket(key, {
        ...changes,
        version: input.version,
      });
      this.store.activity(key, "agent_reorganized", reason, input.agentId);
      return result;
    });
  }
  createSubtask(key, input) {
    return this.store.transaction(() => {
      const { ticket } = this.requireOwnedExecution(key, input);
      const reason = text(input.reason, "Subtask reason", 2000);
      const allowed = [
        "agentId",
        "executionId",
        "sessionId",
        "reason",
        "title",
        "description",
        "brief",
      ];
      if (Object.keys(input).some((k) => !allowed.includes(k)))
        fail(
          422,
          "AGENT_FIELDS",
          "Subtasks inherit the claimed ticket's project and owner.",
        );
      const ready = this.store
        .list("stage", ticket.projectId)
        .find((s) => s.role === "ready");
      const child = this.createTicket({
        projectId: ticket.projectId,
        ownerId: ticket.ownerId,
        parentId: key,
        stageId: ready.id,
        title: input.title,
        description: input.description ?? "",
        brief: input.brief,
      });
      this.store.activity(
        key,
        "agent_subtask",
        `Created subtask ${child.number}: ${reason}`,
        input.agentId,
      );
      return child;
    });
  }
  event(key, input) {
    return this.store.transaction(() => {
      const execution =
        this.store.execution(key) ??
        fail(404, "NOT_FOUND", "Execution not found.");
      if (
        input.agentId !== execution.agentId ||
        input.sessionId !== execution.sessionId
      )
        fail(
          403,
          "SESSION_MISMATCH",
          "Progress belongs to a different agent or session.",
        );
      text(input.eventId, "Event ID", 200);
      const prior = this.store.db
        .prepare("SELECT data FROM events WHERE execution_id=? AND event_id=?")
        .get(key, input.eventId);
      if (prior) {
        const old = JSON.parse(prior.data);
        if (old.seq !== input.seq || old.type !== input.type)
          fail(
            409,
            "EVENT_CONFLICT",
            "Event ID was already used for a different event.",
          );
        return this.store.execution(key);
      }
      if (execution.releasedAt)
        fail(
          409,
          "EXECUTION_FINISHED",
          "This execution is already finished/released.",
        );
      if (!Number.isSafeInteger(input.seq) || input.seq <= execution.lastSeq)
        fail(409, "STALE_EVENT", "Progress sequence must increase.");
      if (
        ![
          "heartbeat",
          "progress",
          "checkpoint",
          "complete",
          "failed",
          "stopped",
        ].includes(input.type)
      )
        fail(422, "VALIDATION", "Unknown progress event type.");
      if (
        input.progress !== undefined &&
        (typeof input.progress !== "number" ||
          input.progress < 0 ||
          input.progress > 100 ||
          !Number.isFinite(input.progress))
      )
        fail(422, "VALIDATION", "Progress must be between 0 and 100.");
      const summary =
        input.type === "heartbeat" && input.summary === undefined
          ? execution.summary
          : text(input.summary, "Progress summary", 4000);
      const terminal = ["checkpoint", "complete", "failed", "stopped"].includes(
        input.type,
      );
      if (
        terminal &&
        (execution.heldSessions ?? []).some((session) => !session.releasedAt)
      ) {
        fail(
          409,
          "HELD_SESSIONS",
          "Reconcile all held source sessions before releasing this imported claim.",
        );
      }
      const next = {
        ...execution,
        lastSeq: input.seq,
        heartbeatAt: now(),
        summary,
        progress: input.progress ?? execution.progress,
        state:
          {
            complete: "awaiting_review",
            checkpoint: "checkpointed",
            failed: "failed",
            stopped: "stopped",
          }[input.type] ?? "running",
        releasedAt: terminal ? now() : null,
      };
      for (const field of ["prUrl", "headSha"])
        if (input[field] !== undefined) {
          if (typeof input[field] !== "string" || input[field].length > 1000)
            fail(422, "VALIDATION", `Invalid ${field}.`);
          next[field] = input[field];
        }
      if (
        next.prUrl &&
        !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(next.prUrl)
      )
        fail(
          422,
          "VALIDATION",
          "PR evidence must be a GitHub pull request URL.",
        );
      this.store.db
        .prepare("INSERT INTO events VALUES(?,?,?,?)")
        .run(key, input.eventId, input.seq, JSON.stringify(input));
      const result = this.store.saveExecution(next);
      if (input.type !== "heartbeat")
        this.store.activity(
          execution.ticketId,
          input.type,
          summary,
          execution.agentId,
        );
      this.changed();
      return result;
    });
  }
  reconcileExternal(key, input) {
    return this.store.transaction(() => {
      const execution =
        this.store.execution(key) ??
        fail(404, "NOT_FOUND", "Execution not found.");
      if (!execution.external)
        fail(409, "LOCAL_EXECUTION", "Use Stop for a server-owned execution.");
      if (input.stopped !== true)
        fail(
          422,
          "CONFIRM_REQUIRED",
          "Confirm this exact source session was stopped or checkpointed in its original client.",
        );
      const summary = text(input.summary, "Checkpoint evidence", 4000);
      const primary = input.sessionId === execution.sessionId;
      if (
        !primary &&
        !(execution.heldSessions ?? []).some(
          (session) => session.sessionId === input.sessionId,
        )
      )
        fail(
          404,
          "SESSION_NOT_FOUND",
          "This source session does not belong to the execution.",
        );
      const heldSessions = (execution.heldSessions ?? []).map((session) =>
        session.sessionId === input.sessionId
          ? { ...session, releasedAt: now(), state: "checkpointed" }
          : session,
      );
      const primaryReconciled = execution.primaryReconciled || primary;
      const released =
        primaryReconciled &&
        heldSessions.every((session) => session.releasedAt);
      const result = this.store.saveExecution({
        ...execution,
        heldSessions,
        primaryReconciled,
        state: released ? "checkpointed" : execution.state,
        releasedAt: released ? now() : execution.releasedAt,
        summary: released
          ? "All imported sessions explicitly checkpointed; ready for handoff."
          : execution.summary,
      });
      this.store.activity(
        execution.ticketId,
        "session_reconciled",
        `${input.sessionId}: ${summary}`,
      );
      this.changed();
      return result;
    });
  }
  handoff(key, input) {
    const ticket = this.require("ticket", key);
    if (this.store.active(key))
      fail(
        409,
        "CHECKPOINT_REQUIRED",
        "The active executor must checkpoint and release before handoff.",
      );
    text(input.summary, "Handoff summary", 4000);
    this.require("agent", input.ownerId);
    const result = this.updateTicket(key, {
      version: ticket.version,
      ownerId: input.ownerId,
    });
    this.store.activity(key, "handoff", input.summary, input.ownerId);
    return result;
  }
  comment(key, input) {
    this.require("ticket", key);
    const result = this.store.activity(
      key,
      "comment",
      text(input.summary, "Comment", 10000),
    );
    this.changed();
    return result;
  }
  updateAgent(key, input) {
    const a = this.require("agent", key);
    if (input.enabled !== undefined && typeof input.enabled !== "boolean")
      fail(422, "VALIDATION", "Enabled must be boolean.");
    const result = this.store.put("agent", {
      ...a,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.name !== undefined
        ? { name: text(input.name, "Agent name", 80) }
        : {}),
    });
    this.changed();
    return result;
  }
}
