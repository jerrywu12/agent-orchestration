import {
  GitHubClient,
  GitHubError,
  reconcileIssue,
  issueSnapshot,
  discoverWorkflowStatus,
  projectStatusRole,
} from "./github.mjs";
import { fail, now } from "./store.mjs";

const PROJECT_SYNC_INTENT = "project-sync-intent";
const MAX_PROJECT_ATTEMPTS = 6;
const projectRetryDelay = (attempts, retryAfterMs = 0) =>
  Math.max(
    Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 0,
    Math.min(300000, 5000 * 2 ** Math.min(Math.max(attempts - 1, 0), 6)),
  );

export class SyncManager {
  constructor(service, { client = new GitHubClient(), auto = true } = {}) {
    this.service = service;
    this.store = service.store;
    this.client = client;
    this.running = new Map();
    this.publishing = new Set();
    this.checkCache = null;
    this.store.db.exec(
      "CREATE TABLE IF NOT EXISTS github_links(repo TEXT NOT NULL,number INTEGER NOT NULL,ticket_id TEXT NOT NULL UNIQUE,PRIMARY KEY(repo,number));",
    );
    if (auto) {
      this.timer = setInterval(() => this.tick().catch(() => {}), 30000);
      this.timer.unref();
    }
  }
  async check() {
    if (this.checkCache && Date.now() - this.checkCache.at < 60000)
      return this.checkCache.value;
    const value = await this.client.check();
    this.checkCache = { at: Date.now(), value };
    return value;
  }
  status(projectId, patch = {}) {
    const previous = this.store.get("sync", projectId) ?? {
      id: projectId,
      projectId,
      state: "idle",
      lastSyncAt: null,
      error: null,
    };
    const intent = this.store.get(PROJECT_SYNC_INTENT, projectId);
    const pending =
      this.store.db
        .prepare(
          "SELECT count(*) AS n FROM sync_jobs j JOIN records r ON r.kind='ticket' AND r.id=j.ticket_id WHERE r.project_id=?",
        )
        .get(projectId).n + (intent ? 1 : 0);
    const next = this.store.put("sync", {
      ...previous,
      ...patch,
      pending,
      attempts: intent?.attempts ?? 0,
      retryAt: intent?.state === "pending" ? intent.retryAt : null,
      retryable: intent?.retryable ?? null,
      retryExhausted: intent?.retryExhausted ?? false,
      errorCode: intent?.errorCode ?? null,
      ...(intent?.lastAttemptAt ? { lastAttemptAt: intent.lastAttemptAt } : {}),
    });
    this.service.changed();
    return next;
  }
  enqueueProject(projectId, { direction = "both" } = {}) {
    const project = this.service.require("project", projectId);
    if (!project.repo)
      fail(422, "REPOSITORY_REQUIRED", "Connect an owner/repository first.");
    if (!["both", "pull"].includes(direction))
      fail(422, "DIRECTION", "Invalid sync direction.");
    // Manual retry restores permission-blocked jobs, preserving their payload in the ticket.
    this.store.db
      .prepare(
        "UPDATE sync_jobs SET state='pending',retry_at=? WHERE ticket_id IN (SELECT id FROM records WHERE kind='ticket' AND project_id=?) AND state='error'",
      )
      .run(now(), projectId);
    if (!this.running.has(projectId)) {
      this.store.put(PROJECT_SYNC_INTENT, {
        id: projectId,
        projectId,
        direction,
        state: "pending",
        attempts: 0,
        createdAt: now(),
        retryAt: now(),
        lastAttemptAt: null,
        error: null,
        errorCode: null,
        retryable: true,
        retryExhausted: false,
      });
    }
    const status = this.status(projectId, { state: "syncing", error: null });
    setImmediate(() =>
      this.syncProject(projectId, { direction }).catch(() => {}),
    );
    return status;
  }
  async tick() {
    for (const intent of this.store.list("publish-intent")) {
      if (
        intent.state === "pending" &&
        intent.retryAt <= now() &&
        !this.publishing.has(intent.id)
      )
        await this.publish(intent.id).catch(() => {});
    }
    for (const project of this.store.list("project")) {
      if (!project.repo || this.running.has(project.id)) continue;
      const intent = this.store.get(PROJECT_SYNC_INTENT, project.id);
      if (intent) {
        // An unfinished first import has no tickets or lastSyncAt yet. Its own durable
        // deadline also takes precedence over ticket jobs and ordinary polling.
        if (intent.state === "pending" && intent.retryAt <= now())
          await this.syncProject(project.id, {
            direction: intent.direction,
          }).catch(() => {});
        continue;
      }
      const state = this.store.get("sync", project.id);
      const due = this.store.db
        .prepare(
          "SELECT 1 FROM sync_jobs j JOIN records r ON r.kind='ticket' AND r.id=j.ticket_id WHERE r.project_id=? AND j.state='pending' AND j.retry_at<=? LIMIT 1",
        )
        .get(project.id, now());
      if (
        due ||
        (state?.lastSyncAt &&
          Date.now() - Date.parse(state.lastSyncAt) > 120000)
      )
        await this.syncProject(project.id).catch(() => {});
    }
  }
  async syncProject(projectId, options = {}) {
    if (this.running.has(projectId)) return this.running.get(projectId);
    const work = this.perform(projectId, options);
    this.running.set(projectId, work);
    try {
      return await work;
    } finally {
      this.running.delete(projectId);
    }
  }
  localSnapshot(ticket) {
    let source = ticket;
    if (ticket.github?.baseline) {
      const projectedOwner = Object.hasOwn(ticket.github, "ownerIdAtSync")
        ? ticket.github.ownerIdAtSync
        : this.remoteOwner(ticket.github.baseline);
      // A null owner may only mean that GitHub routing cannot be represented locally.
      // Preserve its labels unless the user actually changed the owner field.
      if (ticket.ownerId === projectedOwner) {
        const { ownerId, ...rest } = ticket;
        source = rest;
      }
    }
    const result = issueSnapshot(source);
    if (
      ticket.github?.dirty &&
      this.service.require("stage", ticket.stageId).role === "done"
    )
      result.state = "closed";
    return result;
  }
  bind(project, ticket, remote) {
    const other = this.store.db
      .prepare("SELECT ticket_id FROM github_links WHERE repo=? AND number=?")
      .get(project.repo, remote.number);
    if (other && other.ticket_id !== ticket.id)
      fail(
        409,
        "DUPLICATE_GITHUB_LINK",
        "This GitHub issue is already linked to another ticket.",
      );
    this.store.db
      .prepare(
        "INSERT INTO github_links VALUES(?,?,?) ON CONFLICT(repo,number) DO NOTHING",
      )
      .run(project.repo, remote.number, ticket.id);
  }
  importRemote(project, remote) {
    return this.store.transaction(() => {
      let ticket = this.store
        .list("ticket", project.id)
        .find((t) => Number(t.github?.number) === remote.number);
      if (!ticket && remote.agentDeskId) {
        const marked = this.store.get("ticket", remote.agentDeskId);
        // A remote marker cannot claim an arbitrary ticket without our durable publishing intent.
        if (
          marked?.projectId === project.id &&
          this.store.get("publish-intent", marked.id)
        )
          ticket = marked;
      }
      if (ticket?.github?.number) {
        this.bind(project, ticket, remote);
        return ticket;
      }
      const imported = !ticket;
      const assignmentHold = this.assignmentHold(remote);
      if (!ticket) {
        const ownerId = this.remoteOwner(remote);
        ticket = this.service.createTicket({
          projectId: project.id,
          title: remote.title,
          description: remote.description,
          labels: remote.labels ?? [],
          ownerId,
          blockedReason: assignmentHold,
        });
      }
      this.bind(project, ticket, remote);
      const dirty =
        !imported &&
        reconcileIssue({
          local: this.localSnapshot(ticket),
          remote,
          baseline: issueSnapshot(remote),
        }).kind === "local";
      const linked = this.store.put("ticket", {
        ...this.service.require("ticket", ticket.id),
        ...(imported
          ? { title: remote.title, description: remote.description }
          : {}),
        github: {
          number: remote.number,
          url: remote.url,
          nodeId: remote.nodeId,
          state: remote.state,
          baseline: issueSnapshot(remote),
          ownerIdAtSync: this.remoteOwner(remote),
          assignmentHold,
          dirty,
          syncState: dirty ? "pending" : "synced",
          stageIdAtSync: ticket.stageId,
          lastSyncAt: now(),
        },
      });
      if (dirty) this.store.enqueue(ticket.id);
      return linked;
    });
  }
  remoteOwner(remote) {
    const owners = (remote.labels ?? []).filter((l) => l.startsWith("owner:"));
    const candidate = owners.length === 1 ? owners[0].slice(6) : null;
    return candidate && this.store.get("agent", candidate) ? candidate : null;
  }
  assignmentHold(remote) {
    if (this.remoteOwner(remote)) return "";
    const owners = (remote.labels ?? []).filter((label) =>
      label.startsWith("owner:"),
    );
    if (owners.length > 1)
      return "Choose one assigned agent: GitHub has multiple owner labels.";
    if (owners.length)
      return "Choose a supported assigned agent: the GitHub owner label is not recognized.";
    return "Needs an assigned agent";
  }
  conflict(ticket, remote, details = {}) {
    const current = this.service.require("ticket", ticket.id);
    this.store.put("ticket", {
      ...current,
      github: {
        ...current.github,
        syncState: "conflict",
        conflict: {
          ...details,
          remote: details.remote ?? remote,
          local: this.localSnapshot(current),
        },
        error: details.reason ?? "Local and GitHub changes need resolution.",
      },
    });
    this.store.db
      .prepare("UPDATE sync_jobs SET state='conflict' WHERE ticket_id=?")
      .run(ticket.id);
    this.service.changed();
  }
  applyIssue(ticket, remote, expectedVersion) {
    return this.store.transaction(() => {
      const current = this.service.require("ticket", ticket.id);
      if (current.version !== expectedVersion) {
        this.conflict(current, remote, {
          reason: "Ticket changed while GitHub request was in flight.",
        });
        return false;
      }
      const ownerId = this.remoteOwner(remote);
      if (this.store.active(ticket.id) && ownerId !== current.ownerId) {
        this.conflict(current, remote, {
          reason: "Remote ownership conflicts with an active executor.",
        });
        return false;
      }
      const assignmentHold = this.assignmentHold(remote);
      const managedHold =
        !current.blockedReason ||
        current.blockedReason === current.github?.assignmentHold ||
        current.blockedReason === "Needs an assigned agent";
      this.store.put("ticket", {
        ...current,
        title: remote.title,
        description: remote.description,
        labels: remote.labels ?? current.labels,
        ownerId,
        blockedReason: managedHold ? assignmentHold : current.blockedReason,
        updatedAt: now(),
        github: {
          ...current.github,
          number: remote.number,
          url: remote.url,
          nodeId: remote.nodeId,
          state: remote.state,
          baseline: issueSnapshot(remote),
          ownerIdAtSync: ownerId,
          assignmentHold,
          conflict: null,
          error: null,
          lastSyncAt: now(),
        },
      });
      return true;
    });
  }
  async syncStage(project, ticket, remote, item, direction) {
    const mapping = discoverWorkflowStatus(project);
    const localOption =
      mapping[this.service.require("stage", ticket.stageId).role];
    if (!localOption) throw new GitHubError("UNKNOWN_PROJECT_STATUS");
    const remoteRole = item ? projectStatusRole(project, item.status) : null;
    const remoteOption = item?.status?.optionId ?? null;
    const priorOption = ticket.github.projectStatusOptionId;
    const localChanged =
      ticket.github.stageIdAtSync !== undefined &&
      ticket.stageId !== ticket.github.stageIdAtSync;
    const remoteChanged =
      priorOption !== undefined && priorOption !== remoteOption;
    if (localChanged && remoteChanged && localOption !== remoteOption) {
      this.conflict(ticket, remote, {
        reason: "Workflow stage changed in both systems.",
        remoteProjectOptionId: remoteOption,
      });
      return false;
    }
    if (localChanged && localOption !== remoteOption && direction === "pull")
      return false;
    if (
      localOption &&
      project.statusFieldId &&
      direction !== "pull" &&
      ((localChanged && localOption !== remoteOption) || !item)
    ) {
      const response = await this.client.setProjectStatus(
        project.githubProjectId,
        remote.nodeId,
        project.statusFieldId,
        localOption,
        item?.id,
      );
      if (
        this.service.require("ticket", ticket.id).version !== ticket.version
      ) {
        this.conflict(ticket, remote, {
          reason: "Ticket changed while Project status was syncing.",
        });
        return false;
      }
      this.store.put("ticket", {
        ...ticket,
        github: {
          ...ticket.github,
          projectItemId: response.itemId,
          projectStatusOptionId: localOption,
          stageIdAtSync: ticket.stageId,
        },
      });
      return true;
    }
    if (item) {
      const target = this.store
        .list("stage", project.id)
        .find((stage) => stage.role === remoteRole);
      const targetId = target?.id;
      const next = {
        ...ticket,
        github: {
          ...ticket.github,
          projectItemId: item.id,
          projectStatusOptionId: remoteOption,
          projectStatusName: item.status?.name ?? null,
        },
      };
      if (
        target &&
        target.projectId === project.id &&
        target.role !== "done" &&
        targetId !== ticket.stageId &&
        !localChanged &&
        !this.store.active(ticket.id)
      )
        next.stageId = targetId;
      // A remote Done flag is reported as GitHub status, never fabricated merge evidence.
      if (!localChanged || localOption === remoteOption)
        next.github.stageIdAtSync = next.stageId;
      this.store.put("ticket", next);
    }
    // A local workflow change remains pending until its matching remote option is applied.
    return (
      !localChanged ||
      !project.githubProjectNumber ||
      localOption === remoteOption
    );
  }
  finish(ticketId) {
    const ticket = this.service.require("ticket", ticketId);
    this.store.put("ticket", {
      ...ticket,
      github: {
        ...ticket.github,
        dirty: false,
        syncState: "synced",
        error: null,
        conflict: null,
        lastSyncAt: now(),
      },
    });
    this.store.db
      .prepare("DELETE FROM sync_jobs WHERE ticket_id=?")
      .run(ticketId);
  }
  recordError(ticket, error) {
    const current = this.service.require("ticket", ticket.id);
    this.store.put("ticket", {
      ...current,
      github: { ...current.github, syncState: "error", error: error.message },
    });
    const job = this.store.db
      .prepare("SELECT * FROM sync_jobs WHERE ticket_id=?")
      .get(ticket.id);
    const delay = Math.max(
      error.retryAfterMs ?? 0,
      Math.min(300000, 5000 * 2 ** Math.min(job?.attempts ?? 0, 6)),
    );
    this.store.db
      .prepare(
        "INSERT INTO sync_jobs(ticket_id,attempts,retry_at,state,error) VALUES(?,1,?,?,?) ON CONFLICT(ticket_id) DO UPDATE SET attempts=attempts+1,retry_at=excluded.retry_at,state=excluded.state,error=excluded.error",
      )
      .run(
        ticket.id,
        new Date(Date.now() + delay).toISOString(),
        error.retryable === false ? "error" : "pending",
        error.message,
      );
  }
  beginProjectAttempt(projectId, direction) {
    const previous = this.store.get(PROJECT_SYNC_INTENT, projectId);
    const attempts = (previous?.attempts ?? 0) + 1;
    // Save before the first provider await. If the process exits in flight, a fresh
    // manager resumes the pending intent after its recorded backoff, in the same mode.
    return this.store.put(PROJECT_SYNC_INTENT, {
      id: projectId,
      projectId,
      direction,
      state: "pending",
      attempts,
      createdAt: previous?.createdAt ?? now(),
      lastAttemptAt: now(),
      retryAt: new Date(Date.now() + projectRetryDelay(attempts)).toISOString(),
      error: null,
      errorCode: null,
      retryable: true,
      retryExhausted: false,
    });
  }
  recordProjectError(intent, error) {
    const retryable = error.retryable !== false;
    const retryExhausted = retryable && intent.attempts >= MAX_PROJECT_ATTEMPTS;
    const pending = retryable && !retryExhausted;
    this.store.put(PROJECT_SYNC_INTENT, {
      ...intent,
      state: pending ? "pending" : "error",
      retryable,
      retryExhausted,
      retryAt: pending
        ? new Date(
            Date.now() + projectRetryDelay(intent.attempts, error.retryAfterMs),
          ).toISOString()
        : null,
      error: error.message,
      errorCode: error.code ?? "PROJECT_SYNC_FAILED",
    });
  }
  async perform(projectId, { direction = "both" } = {}) {
    let project = this.service.require("project", projectId);
    if (!project.repo)
      fail(422, "REPOSITORY_REQUIRED", "Connect an owner/repository first.");
    if (!["both", "pull"].includes(direction))
      fail(422, "DIRECTION", "Invalid sync direction.");
    const intent = this.beginProjectAttempt(projectId, direction);
    this.status(projectId, { state: "syncing", error: null });
    const errors = [];
    try {
      const remotes = await this.client.listIssues(project.repo);
      let items = [];
      if (project.githubProjectNumber) {
        const board = await this.client.getProject(
          project.repo.split("/")[0],
          project.githubProjectNumber,
        );
        project = this.store.put("project", {
          ...this.service.require("project", projectId),
          githubProjectId: board.id,
          statusFieldId: board.statusFieldId,
          statusOptions: board.statusOptions,
          githubProjectUrl: board.url,
        });
        discoverWorkflowStatus(project);
        items = await this.client.listProjectItems(board.id);
      }
      for (const remote of remotes) {
        let ticket = this.importRemote(project, remote);
        if (ticket.github.syncState === "conflict") continue;
        const job = this.store.db
          .prepare("SELECT * FROM sync_jobs WHERE ticket_id=?")
          .get(ticket.id);
        if (job && (job.state === "error" || job.retry_at > now())) continue;
        try {
          const item = items.find((i) => i.issue?.nodeId === remote.nodeId);
          // Validate before publishing or accepting issue fields. Invalid Status must
          // not consume local intent or silently report the ticket as synchronized.
          if (item) projectStatusRole(project, item.status);
          const result = reconcileIssue({
            local: this.localSnapshot(ticket),
            remote,
            baseline: ticket.github.baseline,
          });
          if (result.kind === "conflict") {
            this.conflict(ticket, remote, result);
            continue;
          }
          if (result.kind === "local" && direction === "pull") continue;
          if (
            result.kind === "local" &&
            this.store.active(ticket.id) &&
            this.remoteOwner(result.merged) !== ticket.ownerId
          ) {
            this.conflict(ticket, remote, {
              reason:
                "Ownership label changes require the active executor to checkpoint before handoff.",
            });
            continue;
          }
          const latest =
            result.kind === "local"
              ? await this.client.updateIssue(
                  project.repo,
                  remote.number,
                  result.merged ?? this.localSnapshot(ticket),
                  ticket.github.baseline,
                )
              : remote;
          if (
            result.kind !== "unchanged" ||
            ticket.github.syncState !== "synced" ||
            ticket.github.dirty
          ) {
            if (!this.applyIssue(ticket, latest, ticket.version)) continue;
          }
          ticket = this.service.require("ticket", ticket.id);
          const stageDone =
            !project.githubProjectNumber ||
            (await this.syncStage(project, ticket, latest, item, direction));
          if (stageDone) this.finish(ticket.id);
        } catch (error) {
          if (error.code === "CONFLICT") {
            this.conflict(
              ticket,
              error.conflict?.remote ?? remote,
              error.conflict ?? {},
            );
            continue;
          }
          errors.push(error.message);
          this.recordError(ticket, error);
        }
      }
      const tickets = this.store.list("ticket", projectId);
      const conflicts = tickets.filter(
        (t) => t.github?.syncState === "conflict",
      ).length;
      const retainedError = tickets.find((t) => t.github?.syncState === "error")
        ?.github.error;
      // Permission/configuration failures may be skipped until manual retry. Their
      // durable ticket jobs must remain visible at project level after polling/restart.
      if (retainedError && !errors.length) errors.push(retainedError);
      // Repository/Project reads finished; individual issue failures retain their own jobs.
      this.store.delete(PROJECT_SYNC_INTENT, projectId);
      return this.status(projectId, {
        state: errors.length ? "error" : conflicts ? "conflict" : "idle",
        lastSyncAt: now(),
        error:
          errors[0] ??
          (conflicts
            ? `${conflicts} ticket(s) need conflict resolution.`
            : null),
      });
    } catch (error) {
      this.recordProjectError(intent, error);
      return this.status(projectId, { state: "error", error: error.message });
    }
  }
  async publish(ticketId) {
    const original = this.service.require("ticket", ticketId);
    const project = this.service.require("project", original.projectId);
    if (!project.repo)
      fail(422, "REPOSITORY_REQUIRED", "Connect a repository first.");
    if (original.github?.number) {
      this.store.delete("publish-intent", ticketId);
      return this.service.getTicket(ticketId);
    }
    if (this.publishing.has(ticketId))
      fail(409, "PUBLISHING", "This ticket is already publishing.");
    this.publishing.add(ticketId);
    const previous = this.store.get("publish-intent", ticketId);
    this.store.put("publish-intent", {
      id: ticketId,
      projectId: project.id,
      state: "pending",
      attempts: (previous?.attempts ?? 0) + 1,
      retryAt: now(),
      createdAt: previous?.createdAt ?? now(),
    });
    try {
      const remote = await this.client.createIssue(project.repo, original);
      this.store.transaction(() => {
        const current = this.service.require("ticket", ticketId);
        this.bind(project, current, remote);
        const dirty =
          reconcileIssue({
            local: this.localSnapshot(current),
            remote,
            baseline: issueSnapshot(remote),
          }).kind === "local";
        this.store.put("ticket", {
          ...current,
          github: {
            ...current.github,
            number: remote.number,
            url: remote.url,
            nodeId: remote.nodeId,
            state: remote.state,
            baseline: issueSnapshot(remote),
            ownerIdAtSync: this.remoteOwner(remote),
            assignmentHold: this.assignmentHold(remote),
            dirty,
            syncState: dirty ? "pending" : "synced",
            stageIdAtSync: current.github?.stageIdAtSync ?? current.stageId,
            lastSyncAt: now(),
          },
        });
        if (dirty) this.store.enqueue(ticketId);
        this.store.delete("publish-intent", ticketId);
        this.store.activity(
          ticketId,
          "github_published",
          `Linked GitHub issue #${remote.number}`,
        );
      });
      this.service.changed();
      return this.service.getTicket(ticketId);
    } catch (error) {
      const intent = this.store.get("publish-intent", ticketId);
      this.store.put("publish-intent", {
        ...intent,
        state:
          error.retryable === false || intent.attempts >= 6
            ? "error"
            : "pending",
        retryAt: new Date(
          Date.now() + Math.max(error.retryAfterMs ?? 0, 30000),
        ).toISOString(),
        error: error.message,
      });
      throw error;
    } finally {
      this.publishing.delete(ticketId);
    }
  }
  resolve(ticketId, choice) {
    if (!["local", "remote"].includes(choice))
      fail(422, "CHOICE", "Choose local or remote.");
    const ticket = this.service.require("ticket", ticketId);
    const conflict = ticket.github?.conflict;
    if (!conflict) fail(409, "NO_CONFLICT", "No saved conflict exists.");
    let next = ticket;
    if (choice === "remote") {
      let targetId;
      if (conflict.remoteProjectOptionId !== undefined) {
        const project = this.service.require("project", ticket.projectId);
        const role = projectStatusRole(project, {
          fieldId: project.statusFieldId,
          optionId: conflict.remoteProjectOptionId,
        });
        targetId = this.store
          .list("stage", project.id)
          .find((stage) => stage.role === role)?.id;
        if (
          !targetId ||
          this.service.require("stage", targetId).role === "done" ||
          this.store.active(ticketId)
        )
          fail(
            409,
            "STAGE_RESOLUTION",
            "Resolve the active session or verify delivery before accepting remote Done status.",
          );
        next = { ...ticket, stageId: targetId };
      }
      if (!this.applyIssue(next, conflict.remote, ticket.version))
        fail(
          409,
          "ACTIVE_CONFLICT",
          "Active ownership must be checkpointed before applying remote changes.",
        );
      next = this.service.require("ticket", ticketId);
      if (conflict.remoteProjectOptionId !== undefined) {
        next = {
          ...next,
          stageId: targetId,
          github: {
            ...next.github,
            projectStatusOptionId: conflict.remoteProjectOptionId,
            stageIdAtSync: targetId,
          },
        };
      }
      this.store.put("ticket", next);
      this.finish(ticketId);
    } else {
      this.store.put("ticket", {
        ...ticket,
        github: {
          ...ticket.github,
          baseline: issueSnapshot(conflict.remote),
          ...(conflict.remoteProjectOptionId !== undefined
            ? { projectStatusOptionId: conflict.remoteProjectOptionId }
            : {}),
          conflict: null,
          error: null,
          dirty: true,
          syncState: "pending",
        },
      });
      this.store.enqueue(ticketId);
    }
    this.store.activity(
      ticketId,
      "sync_resolved",
      `Selected ${choice} changes`,
    );
    this.service.changed();
    return this.service.getTicket(ticketId);
  }
}
