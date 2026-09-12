import { id } from "./store.mjs";

/** The only supported workflow. Remote Status names use these names, never aliases. */
export const WORKFLOW = Object.freeze(
  [
    { name: "Backlog", role: "backlog", color: "#87909b" },
    { name: "Ready", role: "ready", color: "#748ffc" },
    { name: "In progress", role: "active", color: "#f0b35b" },
    { name: "In review", role: "review", color: "#bc8cff" },
    { name: "Done", role: "done", color: "#69b8a2" },
  ].map(Object.freeze),
);

const normalized = (value) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
const aliases = new Map([
  ["backlog", "backlog"],
  ["to do", "backlog"],
  ["todo", "backlog"],
  ["ready", "ready"],
  ["planning", "ready"],
  ["active", "active"],
  ["executing", "active"],
  ["in progress", "active"],
  ["review", "review"],
  ["in review", "review"],
  ["pr / code review", "review"],
  ["code review", "review"],
  ["done", "done"],
]);

/** Legacy input only: Parked and unknown values are held in Backlog. */
export const legacyRole = (value) =>
  aliases.get(normalized(value)) ?? "backlog";
const stageRole = (stage) =>
  normalized(stage.role) === "parked"
    ? null
    : (aliases.get(normalized(stage.role)) ??
      aliases.get(normalized(stage.name)) ??
      null);
const putChanged = (store, kind, previous, next) =>
  JSON.stringify(previous) === JSON.stringify(next)
    ? previous
    : store.put(kind, next);

/**
 * Normalize one project atomically. Surviving role IDs are retained; retired IDs
 * redirect tickets and legacy source mappings only. GitHub snapshots/conflicts and
 * execution/job tables are not rewritten. Retired stageIdAtSync values deliberately
 * survive so normal synchronization can observe a real local workflow change.
 */
export function ensureProjectWorkflow(store, projectId) {
  return store.transaction(() => {
    const project = store.get("project", projectId);
    if (!project) throw new Error("Workflow requires an existing project.");
    const existing = store
      .list("stage", projectId)
      .sort(
        (a, b) =>
          (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id),
      );
    const stages = WORKFLOW.map((definition, position) => {
      const candidates = existing.filter(
        (stage) => stageRole(stage) === definition.role,
      );
      const previous =
        candidates.find((stage) => stage.role === definition.role) ??
        candidates[0];
      const next = {
        ...(previous ?? { id: id(), projectId }),
        ...definition,
        position,
        autoStart: false,
      };
      return previous
        ? putChanged(store, "stage", previous, next)
        : store.put("stage", next);
    });
    const survivors = new Set(stages.map((stage) => stage.id));
    const destinations = new Map(
      existing.map((stage) => [
        stage.id,
        stages.find(
          (candidate) => candidate.role === (stageRole(stage) ?? "backlog"),
        ).id,
      ]),
    );
    for (const ticket of store.list("ticket", projectId)) {
      const stageId = destinations.get(ticket.stageId) ?? stages[0].id;
      if (stageId === ticket.stageId) continue;
      const next = { ...ticket, stageId };
      if (ticket.github?.number && ticket.github.stageIdAtSync === undefined)
        next.github = { ...ticket.github, stageIdAtSync: ticket.stageId };
      store.put("ticket", next);
    }
    for (const record of store.list("migration-record")) {
      const target = record.mapping;
      if (target?.targetKind !== "stage") continue;
      const destination = destinations.get(target.targetId);
      if (destination && destination !== target.targetId)
        store.put("migration-record", {
          ...record,
          mapping: { ...target, targetId: destination },
        });
    }
    for (const stage of existing)
      if (!survivors.has(stage.id)) store.delete("stage", stage.id);
    if (Object.hasOwn(project, "stageMapping")) {
      const { stageMapping: _removed, ...next } = project;
      store.put("project", next);
    }
    return stages;
  });
}

/** One transaction across all projects, with no events, dispatch or outbox writes. */
export function migrateWorkflow(store) {
  return store.transaction(() =>
    store
      .list("project")
      .map((project) => ensureProjectWorkflow(store, project.id)),
  );
}
