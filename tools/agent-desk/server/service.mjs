import { Attachments } from "./attachments.mjs";
import { EventEmitter } from "node:events";
import { fail, id, now } from "./store.mjs";
import { ensureProjectWorkflow, migrateWorkflow } from "./workflow.mjs";
import {
  PREPARATION_FIELDS,
  inspectReadiness,
  scopeSnapshot,
} from "./readiness.mjs";
const efforts = ["XS", "S", "M", "L", "XL"];
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
  ["gemini", "Gemini/Antigravity", "#538ace", "gemini"],
  ["cursor", "Cursor", "#515761", "cursor"],
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
    // Older confirmed transitions may have left a queued launch behind. Retire
    // those requests before any coordinator can observe them on restart.
    for (const intent of store.list("launch-intent"))
      if (["queued", "awaiting_claim"].includes(intent.status))
        store.put("launch-intent", {
          ...intent,
          status: "cancelled",
          reason: "Agent Desk now tracks work without launching agents.",
          updatedAt: now(),
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
      effort: ticket.effort ?? null,
      // Old Done records can retain checkpoint metadata; it is history, not work to resume.
      ...(this.store.get("stage", ticket.stageId)?.role === "done"
        ? { resumeReason: "" }
        : {}),
      attachments: this.attachments.list(ticket.id),
      execution: this.store.latest(ticket.id),
      launchIntent: this.store.get("launch-intent", ticket.id) ?? null,
    };
  }
  getTicket(key) {
    return {
      ...this.decorate(this.require("ticket", key)),
      launchIntentHistory: this.store.list("launch-intent-history")
        .filter((intent) => intent.ticketId === key),
      attachmentContext: this.attachments.list(key, true),
      coordination: this.coordinationContext(key),
    };
  }
  archiveLaunchIntent(key, archiveReason) {
    const intent = this.store.get("launch-intent", key);
    if (!intent) return;
    this.store.put("launch-intent-history", {
      ...intent,
      id: id(),
      originalId: intent.id,
      originalVersion: intent.version,
      archivedAt: now(),
      archiveReason,
    });
    this.store.delete("launch-intent", key);
    this.store.activity(key, "launch_intent_archived", `Historical ${intent.status} launch intent archived: ${archiveReason}`);
  }
  coordinationContext(key) {
    const ticket = this.require("ticket", key);
    const children = this.store.list("ticket", ticket.projectId)
      .filter((candidate) => candidate.parentId === key);
    return {
      role: children.length ? "coordinator" : "implementer",
      implementationHold: children.length
        ? "Parent containers with children cannot launch implementation. Inspect and claim the relevant child separately; parent assignment does not reassign children."
        : null,
      children: children.slice(0, 100).map((candidate) => {
        const active = this.store.active(candidate.id);
        return {
          id: candidate.id,
          number: candidate.number,
          title: candidate.title,
          ownerId: candidate.ownerId,
          stage: this.require("stage", candidate.stageId).name,
          archived: candidate.archived,
          execution: active
            ? { agentId: active.agentId, state: active.state, reserved: true }
            : null,
        };
      }),
      childrenTruncated: children.length > 100,
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
    for (const key of PREPARATION_FIELDS) {
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
    if (ticket.effort != null && !efforts.includes(ticket.effort))
      fail(422, "VALIDATION", "Effort must be XS, S, M, L, XL or null.");
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
      if (this.resolutionNeeded(ticket))
        fail(409, "DELIVERY_HOLD", "Resolve blockers and dependencies before marking done.");
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
        effort: input.effort ?? null,
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
      if (this.require("stage", value.stageId).role === "ready")
        this.assertReadiness(value);
      const result = this.store.put("ticket", value);
      this.attachments.bind(input.attachmentIds ?? [], result.id);
      this.store.activity(value.id, "created", "Ticket created", value.ownerId);
      this.changed();
      return this.decorate(result);
    });
  }
  attachDocuments(key, input) {
    return this.store.transaction(() => {
      const ticket = this.require("ticket", key);
      if (!Number.isSafeInteger(input?.version) || input.version < 1)
        fail(422, "VERSION_REQUIRED", "Provide the ticket version.");
      // An all-bound replay is safe after a lost response, even if the version advanced.
      // Stale new bindings are rolled back with the surrounding transaction.
      const changed = this.attachments.append(input.attachmentIds, key);
      if (!changed) return this.getTicket(key);
      if (input.version !== ticket.version)
        fail(
          409,
          "VERSION_CONFLICT",
          "This ticket changed. Reload before attaching documents.",
        );
      this.store.put(
        "ticket",
        { ...ticket, updatedAt: now() },
        ticket.version,
      );
      this.store.activity(
        key,
        "documents-attached",
        `Attached documents: ${input.attachmentIds
          .map((id) => `${id} (${this.attachments.get(id).sha256})`)
          .join(", ")}`,
      );
      this.changed();
      return this.getTicket(key);
    });
  }
  updateMarkdown(key, input) {
    return this.store.transaction(() => {
      const previous = this.attachments.get(key);
      const attachment = this.attachments.updateMarkdown(key, input);
      const ticket = this.require("ticket", attachment.ticketId);
      this.store.put(
        "ticket",
        { ...ticket, updatedAt: now() },
        ticket.version,
      );
      this.store.activity(
        ticket.id,
        "document-edited",
        `Edited document ${key}: ${previous.sha256} -> ${attachment.sha256}`,
      );
      this.changed();
      return attachment;
    });
  }
  updateTicket(key, input, { confirmedTransition = false, resumeReason, deliveryEvidence } = {}) {
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
      if (resumeReason !== undefined) next.resumeReason = resumeReason;
      if (deliveryEvidence !== undefined) next.delivery = deliveryEvidence;
      for (const k of [
        "title",
        "description",
        "brief",
        "stageId",
        "ownerId",
        "priority",
        "effort",
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
      const role = this.require("stage", next.stageId).role;
      if (next.stageId !== previous.stageId || next.ownerId !== previous.ownerId)
        next.planningAssignment = null;
      if (role === "planning" &&
          (confirmedTransition ||
            (previous.planningAssignment && next.stageId === previous.stageId)))
        next.planningAssignment = {
          stageId: next.stageId,
          ownerId: next.ownerId,
        };
      // Completion supersedes the old resume request, including on legacy records
      // being reopened. The execution and checkpoint history remain untouched.
      if (
        role === "done" ||
        this.require("stage", previous.stageId).role === "done"
      )
        next.resumeReason = "";
      if (
        next.stageId !== previous.stageId &&
        ["planning", "ready"].includes(role) &&
        !confirmedTransition
      )
        fail(
          409,
          "CONFIRMATION_REQUIRED",
          "Select an owner and confirm the transition.",
        );
      if (
        role === "ready" &&
        !next.archived &&
        (next.stageId !== previous.stageId ||
          input.brief !== undefined ||
          next.ownerId !== previous.ownerId)
      )
        this.assertReadiness(next);
      next.title = next.title.trim();
      next.updatedAt = now();
      if (next.github) {
        next.github = { ...next.github, dirty: true, syncState: "pending" };
        this.store.enqueue(key);
      }
      const result = this.store.put("ticket", next, input.version);
      const unclaimedIntent = this.store.get("launch-intent", key);
      if (role === "backlog" && next.stageId !== previous.stageId && unclaimedIntent?.status === "awaiting_claim")
        this.store.put("launch-intent", {
          ...unclaimedIntent,
          status: "cancelled",
          reason: "External admission was returned to Backlog before a session claimed it.",
          updatedAt: now(),
        });
      const changes = [
        "title",
        "stageId",
        "ownerId",
        "priority",
        "effort",
        "blockedReason",
        "resumeReason",
        "archived",
      ].filter((k) => next[k] !== previous[k]);
      this.store.activity(
        key,
        "updated",
        changes.length
          ? `Updated ${changes.map((k) => ({ stageId: "stage", ownerId: "owner", blockedReason: "blocker", resumeReason: "resume request" })[k] ?? k).join(", ")}`
          : "Ticket details updated",
      );
      this.changed();
      if (next.parentId && next.stageId !== previous.stageId) {
        this.syncParentContainerStage(next.parentId);
      }
      if (next.blockedReason !== previous.blockedReason ||
          JSON.stringify(next.dependsOn) !== JSON.stringify(previous.dependsOn)) {
        this.syncParentContainerStage(next.id);
      }
      if (next.stageId !== previous.stageId) {
        for (const dependent of this.store.list("ticket")) {
          if (dependent.dependsOn?.includes(next.id))
            this.syncParentContainerStage(dependent.id);
        }
      }
      return this.decorate(this.require("ticket", result.id));
    });
  }
  repairLaunchIntent(key, input) {
    return this.store.transaction(() => {
      const ticket = this.require("ticket", key);
      const reason = text(input.reason, "Repair reason", 2000);
      if (
        !Number.isSafeInteger(input.version) ||
        !Number.isSafeInteger(input.launchIntentVersion) ||
        input.launchIntentVersion < 1
      )
        fail(
          422,
          "VERSION_REQUIRED",
          "Provide ticket and launch intent versions.",
        );
      if (ticket.version !== input.version)
        fail(
          409,
          "VERSION_CONFLICT",
          "The ticket changed. Reload before repairing.",
        );
      if (this.store.active(key))
        fail(
          409,
          "ACTIVE_EXECUTION",
          "An active execution must retain its launch metadata.",
        );
      if (this.require("stage", ticket.stageId).role !== "done")
        fail(
          409,
          "STAGE_HOLD",
          "Only completed tickets support malformed launch repair.",
        );
      const intent = this.store.get("launch-intent", key);
      if (!intent) return { outcome: "unchanged", ticket: this.getTicket(key) };
      if (intent.version !== input.launchIntentVersion)
        fail(
          409,
          "VERSION_CONFLICT",
          "The launch intent changed. Reload before repairing.",
        );
      if (["queued", "started", "failed"].includes(intent.status))
        fail(
          409,
          "VALID_LAUNCH_INTENT",
          "Valid launch records cannot be erased by repair.",
        );
      const repair = this.store.put("launch-intent-repair", {
        id: id(),
        ticketId: key,
        projectId: ticket.projectId,
        original: intent,
        reason,
        repairedAt: now(),
      });
      this.store.delete("launch-intent", key);
      this.store.activity(
        key,
        "launch_intent_repaired",
        `Archived malformed launch record as ${repair.id}. ${reason}`,
      );
      this.changed();
      return {
        outcome: "repaired",
        repairId: repair.id,
        ticket: this.getTicket(key),
      };
    });
  }
  readiness(key) {
    return inspectReadiness(this, this.require("ticket", key));
  }
  assertReadiness(ticket) {
    const result = inspectReadiness(this, ticket);
    if (!result.ready)
      fail(
        409,
        "NOT_READY",
        `Work is not ready: ${[...result.missing.map((k) => `missing preparation ${k}`), ...result.holds, ...result.conflicts.map((c) => `conflict with ${c.key}: ${c.reasons.join(", ")}`)].join("; ")}`,
      );
    return result;
  }
  launchFingerprint(ticket) {
    return JSON.stringify(
      [
        "title",
        "description",
        "brief",
        "dependsOn",
        "blockedReason",
        "archived",
        "parentId",
        "stageId",
        "ownerId",
      ].map((key) => ticket[key]),
    );
  }
  transition(key, input) {
    const ticket = this.store.transaction(() => {
      if (input.confirmed !== true)
        fail(
          422,
          "CONFIRMATION_REQUIRED",
          "Explicit confirmation is required.",
        );
      if (input.executionMode !== undefined && input.executionMode !== "external")
        fail(422, "EXECUTION_MODE", "Only an existing external session may be identified explicitly.");
      const previous = this.require("ticket", key);
      if (this.store.get("launch-intent", key)?.status === "awaiting_claim")
        fail(409, "EXTERNAL_CLAIM_PENDING", "The previously confirmed external session must claim or be reconciled before changing this ticket.");
      if (input.version !== previous.version)
        fail(
          409,
          "VERSION_CONFLICT",
          "This ticket changed. Reload before confirming.",
        );
      const stage = this.require("stage", input.stageId);
      if (!["planning", "ready"].includes(stage.role))
        fail(422, "TRANSITION_STAGE", "Confirm Planning or Ready.");
      const agent = this.require("agent", input.ownerId);
      if (!agent.enabled)
        fail(422, "AGENT_DISABLED", "This agent is disabled.");
      if (this.store.active(key))
        fail(
          409,
          "ALREADY_CLAIMED",
          "Checkpoint the existing session before changing its stage or owner.",
        );
      if (previous.archived)
        fail(409, "ARCHIVED", "Archived work cannot change stage.");
      if (stage.role === "ready")
        this.assertReadiness({
          ...previous,
          stageId: input.stageId,
          ownerId: input.ownerId,
        });
      const result = this.updateTicket(
        key,
        {
          version: input.version,
          stageId: input.stageId,
          ownerId: input.ownerId,
        },
        { confirmedTransition: true },
      );
      this.archiveLaunchIntent(key, "Superseded by a tracking-only stage confirmation.");
      this.store.activity(key, "stage_confirmed", `Moved to ${stage.name}; assigned agent ${agent.id}. Agent Desk did not launch an agent.`);
      return result;
    });
    this.changed();
    return { ticket: this.getTicket(key), outcome: "moved" };
  }
  dispatchIntent(key) {
    const intent = this.store.get("launch-intent", key);
    if (intent?.status === "queued") {
      this.store.put("launch-intent", {
        ...intent,
        status: "cancelled",
        reason: "Agent Desk now tracks work without launching agents.",
        updatedAt: now(),
      });
      this.changed();
    }
    return { outcome: "cancelled" };
  }
  dispatchConfirmed() {
    for (const intent of this.store.list("launch-intent"))
      if (intent.confirmed && intent.status === "queued")
        this.dispatchIntent(intent.ticketId);
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
    if (stage.role === "planning") return ticket;
    this.assertReadiness(ticket);
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
      const ticket = this.ready(key, input.agentId, { resolveBlockers });
      const pendingExternalIntent = this.store.get("launch-intent", key);
      if (pendingExternalIntent?.status === "awaiting_claim" &&
          (input.external !== true ||
            pendingExternalIntent.ownerId !== input.agentId ||
            pendingExternalIntent.stageId !== ticket.stageId ||
            pendingExternalIntent.fingerprint !== this.launchFingerprint(ticket)))
        fail(409, "EXTERNAL_INTENT_CHANGED", "The external admission changed; return it to Backlog and confirm the current owner and scope again.");
      const purpose = resolveBlockers
        ? "resolve_blockers"
        : this.require("stage", ticket.stageId).role === "planning"
          ? "planning"
          : "implementation";
      const execution = this.store.saveExecution({
        id: id(),
        ticketId: key,
        purpose,
        scopeSnapshot:
          purpose === "implementation"
            ? scopeSnapshot(ticket, this.require("project", ticket.projectId))
            : null,
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
      if (purpose === "planning" && ticket.planningAssignment)
        this.store.put("ticket", {
          ...ticket,
          planningAssignment: null,
          updatedAt: now(),
        }, ticket.version);
      // A new independently claimed session supersedes a historical launch
      // display record; its telemetry must describe this exact execution.
      if (this.store.get("launch-intent", key)?.status === "started")
        this.archiveLaunchIntent(key, "Superseded by an independently claimed session.");
      this.bindPendingLaunches(execution);
      if (purpose === "implementation") {
        const activeStage = this.store
          .list("stage", ticket.projectId)
          .find((s) => s.role === "active");
        if (ticket.stageId !== activeStage.id || ticket.resumeReason)
          this.updateTicket(
            key,
            {
              version: ticket.version,
              stageId: activeStage.id,
            },
            { resumeReason: "" },
          );
      }
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
  bindPendingLaunches(execution) {
    // The claim and its pending requests commit together. A fast external/direct
    // run may finish before the next drain; its authorization must not replay.
    const intent = this.store.get("launch-intent", execution.ticketId);
    if (["queued", "awaiting_claim"].includes(intent?.status))
      this.store.put("launch-intent", {
        ...intent,
        status: "started",
        executionId: execution.id,
        sessionId: execution.sessionId,
        code: undefined,
        reason: "Confirmed work has an execution.",
        updatedAt: now(),
      });
    for (const batch of this.store.list("run-batch")) {
      if (
        batch.state !== "running" ||
        !batch.results.some(
          (row) =>
            row.ticketId === execution.ticketId && row.status === "queued",
        )
      )
        continue;
      this.store.put("run-batch", {
        ...batch,
        results: batch.results.map((row) =>
          row.ticketId === execution.ticketId && row.status === "queued"
            ? {
                ...row,
                status: "running",
                executionId: execution.id,
                queueReason: undefined,
                code: undefined,
                message: "Execution started.",
              }
            : row,
        ),
      });
    }
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
      const { ticket, execution } = this.requireOwnedExecution(key, input);
      const reason = text(
        input.reason,
        "Evidence or reorganization reason",
        2000,
      );
      const changes = input.changes;
      if (
        changes?.stageId &&
        ["planning", "resolve_blockers"].includes(execution.purpose) &&
        !["backlog", "planning"].includes(
          this.require("stage", changes.stageId).role,
        )
      )
        fail(
          409,
          "PLANNING_ONLY",
          "Preparation sessions cannot promote work into implementation or review.",
        );
      const allowed = [
        "title",
        "description",
        "brief",
        "effort",
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
          "Only task content, effort, blockers, dependencies, parent and unfinished stages can be updated.",
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
  deliveryContext(key, input) {
    const ticket = this.require("ticket", key);
    if (!ticket.ownerId || ticket.ownerId !== input.agentId)
      fail(403, "OWNER_MISMATCH", "This ticket is not assigned to your agent.");
    if (!Number.isSafeInteger(input.version) || input.version < 1)
      fail(422, "VERSION_REQUIRED", "Provide the ticket version.");
    if (input.version !== ticket.version)
      fail(409, "VERSION_CONFLICT", "This ticket changed. Reload before delivery.");
    if (ticket.archived || !this.require("agent", input.agentId).enabled)
      fail(409, "DELIVERY_HOLD", "Archived work or disabled agents cannot deliver tickets.");
    if (this.store.active(key))
      fail(409, "ACTIVE_EXECUTION", "Finish and release the execution before delivery.");
    if (this.require("stage", ticket.stageId).role !== "review")
      fail(409, "REVIEW_REQUIRED", "The ticket must be in review before delivery.");
    if (this.resolutionNeeded(ticket))
      fail(409, "DELIVERY_HOLD", "Resolve blockers and dependencies before delivery.");
    const execution = this.store.latest(key);
    if (
      !execution ||
      execution.id !== input.executionId ||
      execution.agentId !== input.agentId ||
      execution.sessionId !== input.sessionId ||
      execution.state !== "awaiting_review" ||
      !execution.releasedAt
    )
      fail(403, "SESSION_MISMATCH", "The latest completed assigned execution is required.");
    if ((execution.heldSessions ?? []).some((session) => !session.releasedAt))
      fail(409, "HELD_SESSIONS", "Reconcile held sessions before delivery.");
    const reviewerId = text(input.reviewerId, "Independent reviewer identity", 200);
    if (reviewerId.toLowerCase() === input.agentId.toLowerCase())
      fail(422, "REVIEWER_REQUIRED", "The reviewer must differ from the implementing agent.");
    if (!/^[a-f0-9]{40}$/i.test(input.reviewedHeadSha ?? ""))
      fail(422, "REVIEW_HEAD_REQUIRED", "Provide the exact reviewed PR head SHA.");
    if (input.reviewedHeadSha.toLowerCase() !== execution.headSha?.toLowerCase())
      fail(409, "REVIEW_HEAD_MISMATCH", "Independent review must cover the completed PR head.");
    const reviewEvidence = text(input.reviewEvidence, "Independent review evidence", 2000);
    const verificationEvidence = text(input.verificationEvidence, "Verification evidence", 2000);
    const runtimeEvidence = text(input.runtimeEvidence, "Merged runtime evidence", 2000);
    const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)$/.exec(execution.prUrl ?? "");
    const project = this.require("project", ticket.projectId);
    if (!match || match[1].toLowerCase() !== project.repo?.toLowerCase())
      fail(409, "PR_MISMATCH", "The completed execution needs a PR in this project repository.");
    if (!/^[a-f0-9]{40}$/i.test(execution.headSha ?? ""))
      fail(409, "HEAD_REQUIRED", "The completed execution needs an exact PR head SHA.");
    return {
      ticket,
      execution,
      repo: project.repo,
      number: Number(match[2]),
      reviewerId,
      reviewEvidence,
      verificationEvidence,
      runtimeEvidence,
    };
  }
  deliver(key, input, pullRequest) {
    return this.store.transaction(() => {
      const context = this.deliveryContext(key, input);
      const { ticket, execution } = context;
      if (
        pullRequest?.merged !== true ||
        !Number.isFinite(Date.parse(pullRequest.mergedAt ?? "")) ||
        !/^[a-f0-9]{40}$/i.test(pullRequest.mergeCommitSha ?? "")
      )
        fail(409, "PR_NOT_MERGED", "GitHub must confirm a merged PR and merge commit.");
      if (
        pullRequest.repo?.toLowerCase() !== context.repo.toLowerCase() ||
        pullRequest.number !== context.number ||
        pullRequest.url !== execution.prUrl ||
        pullRequest.headSha?.toLowerCase() !== execution.headSha.toLowerCase()
      )
        fail(409, "PR_MISMATCH", "GitHub PR does not match the completed execution.");
      const stage = this.store.list("stage", ticket.projectId).find((candidate) => candidate.role === "done");
      const delivery = {
        agentId: input.agentId,
        executionId: execution.id,
        sessionId: execution.sessionId,
        prUrl: execution.prUrl,
        headSha: execution.headSha,
        mergeCommitSha: pullRequest.mergeCommitSha,
        mergedAt: pullRequest.mergedAt,
        reviewerId: context.reviewerId,
        reviewedHeadSha: input.reviewedHeadSha,
        reviewEvidence: context.reviewEvidence,
        verificationEvidence: context.verificationEvidence,
        runtimeEvidence: context.runtimeEvidence,
        deliveredAt: now(),
      };
      const result = this.updateTicket(key, { version: ticket.version, stageId: stage.id }, { deliveryEvidence: delivery });
      this.store.activity(key, "agent_delivered", `${execution.prUrl} merged at ${pullRequest.mergeCommitSha}; reviewed and verified.`, input.agentId);
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
        "effort",
        "dependsOn",
      ];
      if (Object.keys(input).some((k) => !allowed.includes(k)))
        fail(
          422,
          "AGENT_FIELDS",
          "Subtasks inherit the claimed ticket's project and owner.",
        );
      const ready = this.store
        .list("stage", ticket.projectId)
        .find((s) => s.role === "planning");
      const dependencies = strings(input.dependsOn ?? [], "Dependencies");
      for (const dependency of dependencies)
        if (this.require("ticket", dependency).projectId !== ticket.projectId)
          fail(
            422,
            "PROJECT_MISMATCH",
            "Child dependencies must belong to the same project.",
          );
      const child = this.createTicket({
        projectId: ticket.projectId,
        ownerId: ticket.ownerId,
        parentId: key,
        stageId: ready.id,
        title: input.title,
        description: input.description ?? "",
        brief: input.brief,
        effort: input.effort,
        dependsOn: dependencies,
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
  isPlanningExecutionComplete(execution) {
    if (!execution || !execution.releasedAt) return false;
    if (["failed", "stopped", "revoked"].includes(execution.state)) return false;
    if (execution.state === "awaiting_review") return true;
    const last = this.store.db
      .prepare(
        "SELECT data FROM events WHERE execution_id=? ORDER BY seq DESC LIMIT 1",
      )
      .get(execution.id);
    if (!last) return false;
    try {
      return JSON.parse(last.data).type === "complete";
    } catch {
      return false;
    }
  }
  settleExecutionStage(execution, eventType) {
    let toAdvance = null;
    const resultTicket = this.store.transaction(() => {
      const current = this.store.execution(execution.id);
      const ticket = this.require("ticket", execution.ticketId);
      if (
        !current?.releasedAt ||
        ![
          "awaiting_review",
          "checkpointed",
          "failed",
          "stopped",
          "revoked",
        ].includes(current.state) ||
        this.store.active(ticket.id) ||
        this.store.latest(ticket.id)?.id !== execution.id ||
        ticket.ownerId !== current.agentId
      )
        return ticket;
      if (current.purpose === "planning") {
        if (
          this.isPlanningExecutionComplete(current) &&
          !ticket.blockedReason &&
          !this.resolutionNeeded(ticket)
        ) {
          toAdvance = ticket.id;
        }
        return ticket;
      }
      if (
        this.require("stage", ticket.stageId).role !== "active" ||
        this.store.list("ticket").some((t) => t.parentId === ticket.id)
      )
        return ticket;
      const complete =
        eventType === "complete" && current.state === "awaiting_review";
      const target = this.store
        .list("stage", ticket.projectId)
        .find((s) => s.role === (complete ? "review" : "backlog"));
      const resumeReason = complete
        ? ""
        : `Execution ${current.state}; work and session history retained. Explicitly resume after reviewing the checkpoint. ${current.summary || ""}`.slice(
            0,
            4000,
          );
      return this.updateTicket(
        ticket.id,
        { version: ticket.version, stageId: target.id },
        { resumeReason },
      );
    });
    if (toAdvance && !this.store.inTransaction) {
      this.advancePlanningTickets(toAdvance);
    }
    if (resultTicket.parentId && !this.store.inTransaction) {
      this.syncParentContainerStage(resultTicket.parentId);
    }
    return resultTicket;
  }
  advancePlanningTickets(targetTicketId = null) {
    const candidates = targetTicketId
      ? [this.store.get("ticket", targetTicketId)].filter(Boolean)
      : this.store.list("ticket");
    const advanced = [];
    for (const ticket of candidates) {
      if (ticket.archived) continue;
      if (ticket.blockedReason) continue;
      if (this.resolutionNeeded(ticket)) continue;

      const children = this.store
        .list("ticket", ticket.projectId)
        .filter((t) => t.parentId === ticket.id);

      if (children.length > 0) {
        // Parent ticket: verify parent planning execution completed successfully
        const latest = this.store.latest(ticket.id);
        if (
          !latest ||
          latest.purpose !== "planning" ||
          !this.isPlanningExecutionComplete(latest)
        )
          continue;

        for (const child of children) {
          if (
            child.archived ||
            child.blockedReason ||
            this.resolutionNeeded(child)
          )
            continue;
          const childStage = this.store.get("stage", child.stageId);
          if (childStage?.role !== "planning" || this.store.active(child.id))
            continue;
          const r = this.readiness(child.id);
          if (r.ready) {
            const readyStage = this.store
              .list("stage", child.projectId)
              .find((s) => s.role === "ready");
            if (readyStage) {
              try {
                this.transition(child.id, {
                  version: child.version,
                  stageId: readyStage.id,
                  ownerId: child.ownerId,
                  confirmed: true,
                });
                advanced.push(child.id);
              } catch {}
            }
          }
        }
        this.syncParentContainerStage(ticket.id);
      } else {
        // Leaf ticket (standalone or child subtask)
        const stage = this.store.get("stage", ticket.stageId);
        if (!stage || stage.role !== "planning") continue;
        if (this.store.active(ticket.id)) continue;

        const planningExecution =
          this.store.latest(ticket.id) ??
          (ticket.parentId ? this.store.latest(ticket.parentId) : null);
        if (
          !planningExecution ||
          planningExecution.purpose !== "planning" ||
          !this.isPlanningExecutionComplete(planningExecution)
        )
          continue;

        const r = this.readiness(ticket.id);
        if (r.ready) {
          const readyStage = this.store
            .list("stage", ticket.projectId)
            .find((s) => s.role === "ready");
          if (readyStage) {
            try {
              this.transition(ticket.id, {
                version: ticket.version,
                stageId: readyStage.id,
                ownerId: ticket.ownerId,
                confirmed: true,
              });
              advanced.push(ticket.id);
            } catch {}
          }
        }
      }
    }
    this.syncAllParentContainers();
    return advanced;
  }
  syncParentContainerStage(parentId) {
    if (!parentId) return;
    const parent = this.store.get("ticket", parentId);
    if (!parent || parent.archived) return;

    const children = this.store
      .list("ticket", parent.projectId)
      .filter((t) => t.parentId === parent.id && !t.archived);
    if (children.length === 0) return;

    const parentActive = this.store.active(parent.id);
    if (parentActive && parentActive.purpose === "planning") return;
    if (
      this.require("stage", parent.stageId).role === "planning" &&
      parent.planningAssignment?.stageId === parent.stageId &&
      parent.planningAssignment?.ownerId === parent.ownerId
    ) return;

    const stages = this.store.list("stage", parent.projectId);
    const stageMap = new Map(stages.map((s) => [s.id, s]));
    const childRoles = children
      .map((c) => stageMap.get(c.stageId)?.role)
      .filter(Boolean);
    if (childRoles.length === 0) return;

    let targetRole = null;
    if (childRoles.every((r) => r === "done")) {
      targetRole = "done";
    } else if (
      childRoles.every((r) => r === "review" || r === "done") &&
      childRoles.some((r) => r === "review")
    ) {
      targetRole = "review";
    } else if (childRoles.some((r) => r === "active" || r === "review")) {
      targetRole = "active";
    }

    // Existing children are not the whole plan while the parent retains an
    // explicit hold or an unfinished hard dependency.
    if (["review", "done"].includes(targetRole) && (
      parent.blockedReason ||
      (parent.dependsOn ?? []).some((key) =>
        this.require("stage", this.require("ticket", key).stageId).role !== "done")
    )) targetRole = "active";

    if (targetRole) {
      const currentRole = stageMap.get(parent.stageId)?.role;
      if (currentRole !== targetRole) {
        const targetStage = stages.find((s) => s.role === targetRole);
        if (targetStage) {
          try {
            const updated = this.updateTicket(parent.id, {
              version: parent.version,
              stageId: targetStage.id,
            });
            if (updated.parentId) {
              this.syncParentContainerStage(updated.parentId);
            }
          } catch {}
        }
      }
    }
  }
  syncAllParentContainers() {
    const tickets = this.store.list("ticket");
    const parentIds = new Set(
      tickets.map((t) => t.parentId).filter(Boolean),
    );
    for (const parentId of parentIds) {
      this.syncParentContainerStage(parentId);
    }
  }
  planningAdmission(ticketId) {
    const ticket = this.require("ticket", ticketId);
    const children = this.store.list("ticket", ticket.projectId)
      .filter((child) => child.parentId === ticketId);
    const candidates = children.length ? children : [ticket];
    const parentHolds = children.length ? [
      ...(ticket.archived ? ["Parent is archived."] : []),
      ...(ticket.blockedReason ? ["Parent has an unresolved blocker."] : []),
      ...((ticket.dependsOn ?? []).some((id) =>
        this.require("stage", this.require("ticket", id).stageId).role !== "done"
      ) ? ["Parent has an unfinished dependency."] : []),
    ] : [];
    return {
      source: { ticketId, stage: this.require("stage", ticket.stageId).role },
      tickets: candidates.slice(0, 100).map((candidate) => {
        const stage = this.require("stage", candidate.stageId).role;
        const readiness = stage === "planning" ? this.readiness(candidate.id) : null;
        return {
          ticketId: candidate.id,
          stage,
          admissionHolds: stage === "planning" ? parentHolds : [],
          readiness: readiness && {
            ready: readiness.ready,
            missing: readiness.missing,
            holds: readiness.holds,
            conflictCount: readiness.conflicts.length,
          },
        };
      }),
      truncated: candidates.length > 100,
    };
  }
  event(key, input) {
    let ticketId = null;
    const result = this.store.transaction(() => {
      const execution =
        this.store.execution(key) ??
        fail(404, "NOT_FOUND", "Execution not found.");
      ticketId = execution.ticketId;
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
      let summary =
        input.type === "heartbeat" && input.summary === undefined
          ? execution.summary
          : text(input.summary, "Progress summary", 4000);
      // Every transport shares this invariant. Keep the original event input for
      // idempotent replay while recording the truthful effective outcome.
      const eventType =
        input.type === "complete" &&
        (execution.purpose === "planning" ||
          (execution.managedBy === "agent-desk" &&
            this.resolutionNeeded(this.require("ticket", execution.ticketId))))
          ? "checkpoint"
          : input.type;
      if (eventType !== input.type)
        summary =
          `${execution.purpose === "planning" ? "Planning prepared for review." : "Unresolved blockers or dependencies remain."} ${summary}`.slice(
            0,
            4000,
          );
      const terminal = ["checkpoint", "complete", "failed", "stopped"].includes(
        input.type,
      );
      if (
        terminal &&
        (this.store.active(execution.ticketId)?.id !== execution.id ||
          this.require("ticket", execution.ticketId).ownerId !==
            execution.agentId)
      )
        fail(
          409,
          "EXECUTION_CHANGED",
          "Only the current owned execution can finish this ticket.",
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
        lastActivityAt:
          input.type === "heartbeat"
            ? (execution.lastActivityAt ?? null)
            : now(),
        summary,
        progress: input.progress ?? execution.progress,
        state:
          {
            complete: "awaiting_review",
            checkpoint: "checkpointed",
            failed: "failed",
            stopped: "stopped",
          }[eventType] ?? "running",
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
      if (terminal) this.settleExecutionStage(result, eventType);
      if (input.type !== "heartbeat")
        this.store.activity(
          execution.ticketId,
          eventType,
          summary,
          execution.agentId,
        );
      this.changed();
      return result;
    });
    if (input.type === "complete" && ticketId) {
      this.advancePlanningTickets(ticketId);
      const t = this.store.get("ticket", ticketId);
      if (t?.parentId) {
        this.syncParentContainerStage(t.parentId);
      }
    }
    if (result.releasedAt && result.purpose === "planning" && ticketId) {
      this.syncParentContainerStage(ticketId);
    }
    return input.type === "complete" && result.purpose === "planning" && result.releasedAt
      ? { ...result, planningAdmission: this.planningAdmission(ticketId) }
      : result;
  }
  reconcileExternal(key, input) {
    const result = this.store.transaction(() => {
      const execution =
        this.store.execution(key) ??
        fail(404, "NOT_FOUND", "Execution not found.");
      if (!execution.external)
        fail(409, "LOCAL_EXECUTION", "Use Stop for a server-owned execution.");
      if (execution.releasedAt)
        fail(
          409,
          "EXECUTION_FINISHED",
          "This execution is already finished/released.",
        );
      if (this.store.active(execution.ticketId)?.id !== execution.id)
        fail(
          409,
          "EXECUTION_CHANGED",
          "Reconcile only the current exact reservation.",
        );
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
      if (released) this.settleExecutionStage(result, "checkpoint");
      this.store.activity(
        execution.ticketId,
        "session_reconciled",
        `${input.sessionId}: ${summary}`,
      );
      this.changed();
      return result;
    });
    if (result.releasedAt && result.purpose === "planning") {
      this.syncParentContainerStage(result.ticketId);
    }
    return result;
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
