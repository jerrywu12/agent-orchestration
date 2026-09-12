import { EventEmitter } from "node:events";
import { fail, id, now } from "./store.mjs";
const roles = ["backlog", "planning", "active", "review", "done", "parked"];
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
const defaults = [
  ["Backlog", "backlog", "#87909b"],
  ["Planning", "planning", "#9471c5"],
  ["In progress", "active", "#e0a339"],
  ["In review", "review", "#4d8ecb"],
  ["Done", "done", "#3b956e"],
];
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
    return { ...ticket, execution: this.store.latest(ticket.id) };
  }
  getTicket(key) {
    return this.decorate(this.require("ticket", key));
  }
  createProject(input) {
    return this.store.transaction(() => {
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
        stageMapping: {},
        createdAt: now(),
        ...this.projectFields(input),
      });
      for (const [name, role, color] of defaults)
        this.createStage({ projectId: p.id, name, role, color });
      this.changed();
      return p;
    });
  }
  projectFields(input) {
    const fields = {};
    for (const k of [
      "name",
      "path",
      "repo",
      "githubProjectId",
      "statusFieldId",
    ])
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
    if (input.stageMapping !== undefined) {
      if (
        !input.stageMapping ||
        typeof input.stageMapping !== "object" ||
        Array.isArray(input.stageMapping) ||
        Object.values(input.stageMapping).some((v) => typeof v !== "string")
      )
        fail(422, "VALIDATION", "Invalid stage mapping.");
      fields.stageMapping = input.stageMapping;
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
  createStage(input) {
    this.require("project", input.projectId);
    const stage = {
      id: input.id ?? id(),
      projectId: input.projectId,
      name: text(input.name, "Stage name", 80),
      role: input.role ?? "active",
      color: input.color ?? "#87909b",
      position:
        input.position ?? this.store.list("stage", input.projectId).length,
      autoStart: false,
    };
    this.validateStage(stage);
    const result = this.store.put("stage", stage);
    this.changed();
    return result;
  }
  validateStage(s) {
    if (
      !roles.includes(s.role) ||
      !/^#[0-9a-fA-F]{6}$/.test(s.color) ||
      !Number.isFinite(s.position) ||
      s.position < 0 ||
      typeof s.autoStart !== "boolean"
    )
      fail(
        422,
        "VALIDATION",
        "Invalid stage role, color, order or automation.",
      );
  }
  updateStage(key, input) {
    const s = this.require("stage", key);
    const next = { ...s };
    for (const k of ["name", "role", "color", "position", "autoStart"])
      if (input[k] !== undefined) next[k] = input[k];
    next.name = text(next.name, "Stage name", 80);
    this.validateStage(next);
    if (
      next.role !== s.role &&
      this.store.list("ticket", s.projectId).some((t) => t.stageId === key)
    )
      fail(
        409,
        "STAGE_IN_USE",
        "Move tickets out of this stage before changing its semantic role.",
      );
    const result = this.store.put("stage", next);
    this.changed();
    return result;
  }
  deleteStage(key) {
    this.require("stage", key);
    if (this.store.list("ticket").some((t) => t.stageId === key))
      fail(409, "STAGE_IN_USE", "Move tickets to another stage first.");
    this.store.delete("stage", key);
    this.changed();
    return { ok: true };
  }
  validateTicket(ticket) {
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
  ready(key, agentId) {
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
    if (ticket.blockedReason)
      fail(409, "BLOCKED", `Ticket is blocked: ${ticket.blockedReason}`);
    if (
      ["backlog", "done", "parked"].includes(
        this.require("stage", ticket.stageId).role,
      )
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
  claim(key, input) {
    return this.store.transaction(() => {
      const ticket = this.ready(key, input.agentId);
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
