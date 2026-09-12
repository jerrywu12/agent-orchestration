import { useState, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Github,
  Plus,
  RefreshCw,
  Save,
  Server,
  Trash2,
} from "lucide-react";
import { api, errorMessage, pathId } from "../api";
import type {
  DeskState,
  Health,
  Integrations,
  Project,
  Stage,
  StageRole,
} from "../types";
import {
  capitalize,
  EmptyState,
  ErrorNotice,
  StageIcon,
  timeAgo,
} from "./shared";

export function SettingsView({
  state,
  projectId,
  health,
  integrations,
  refresh,
  onCreateProject,
}: {
  state: DeskState;
  projectId: string;
  health: Health | null;
  integrations: Integrations | null;
  refresh: () => Promise<void>;
  onCreateProject: () => void;
}) {
  const [selected, setSelected] = useState(
    projectId || state.projects[0]?.id || "",
  );
  const project =
    state.projects.find((item) => item.id === selected) || state.projects[0];
  return (
    <div className="standard-page settings-page">
      <div className="standard-heading">
        <div className="page-kicker">WORKSPACE / CONFIGURATION</div>
        <h1>Settings</h1>
        <p>Shape your workflow and connect the places where your work lives.</p>
      </div>
      <div className="settings-project-picker">
        <label>
          Project
          <select
            value={project?.id || ""}
            onChange={(event) => setSelected(event.target.value)}
          >
            {state.projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <button className="button small-button" onClick={onCreateProject}>
          <Plus size={14} />
          New project
        </button>
      </div>
      {project ? (
        <ProjectSettings
          key={project.id}
          project={project}
          state={state}
          integrations={integrations}
          refresh={refresh}
        />
      ) : (
        <EmptyState title="Set up your first project">
          Create a project to configure stages, a working directory, and GitHub
          sync.
        </EmptyState>
      )}
      <section className="settings-section service-section">
        <div className="section-title">
          <h2>
            <Server size={16} />
            Workspace service
          </h2>
          <span className="status-chip">
            {state.capabilities.localMode
              ? "Local access"
              : "Authenticated access"}
          </span>
        </div>
        <p className="field-hint">
          Agent Desk keeps work and activity on this server. Browser updates
          refresh every four seconds.
        </p>
        {health && (
          <dl className="service-facts">
            <dt>Version</dt>
            <dd>{health.version}</dd>
            <dt>Storage</dt>
            <dd>{health.storage}</dd>
            <dt>Checkout</dt>
            <dd>{health.root}</dd>
            <dt>Revision</dt>
            <dd>{health.sha || "Not available"}</dd>
          </dl>
        )}
      </section>
    </div>
  );
}
function ProjectSettings({
  project,
  state,
  integrations,
  refresh,
}: {
  project: Project;
  state: DeskState;
  integrations: Integrations | null;
  refresh: () => Promise<void>;
}) {
  const [name, setName] = useState(project.name);
  const [path, setPath] = useState(project.path || "");
  const [repo, setRepo] = useState(project.repo || "");
  const [projectNumber, setProjectNumber] = useState(
    project.githubProjectNumber?.toString() || "",
  );
  const [mapping, setMapping] = useState<Record<string, string>>(
    project.stageMapping || {},
  );
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const stages = state.stages
    .filter((item) => item.projectId === project.id)
    .sort((a, b) => a.position - b.position);
  const sync = state.sync.find((item) => item.projectId === project.id);
  async function perform(
    key: string,
    callback: () => Promise<unknown>,
    success: string,
  ) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await callback();
      await refresh();
      setNotice(success);
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    } finally {
      setBusy("");
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    await perform(
      "save",
      () =>
        api(`/projects/${pathId(project.id)}`, "PATCH", {
          name: name.trim(),
          path: path.trim() || null,
          repo: repo.trim() || null,
          githubProjectNumber: projectNumber ? Number(projectNumber) : null,
          stageMapping: Object.fromEntries(
            Object.entries(mapping).filter(([, value]) => value),
          ),
        }),
      "Project settings saved.",
    );
  }
  return (
    <>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {notice && (
        <div className="success-notice" role="status">
          <Check size={14} />
          {notice}
        </div>
      )}
      <form onSubmit={save}>
        <section className="settings-section">
          <h2>Project details</h2>
          <div className="settings-form-grid">
            <label>
              Name
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Identifier
              <input value={project.key} disabled />
              <span className="field-hint">Used in ticket references.</span>
            </label>
            <label className="full-span">
              Working directory
              <input
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="/absolute/path/to/project"
              />
              <span className="field-hint">
                An existing local directory is required to start an agent.
              </span>
            </label>
          </div>
        </section>
        <section className="settings-section">
          <div className="section-title">
            <h2>
              <Github size={16} />
              GitHub
            </h2>
            <span
              className={`status-chip ${integrations?.github.available ? "active" : "warning"}`}
            >
              {integrations
                ? integrations.github.available
                  ? integrations.github.login
                    ? `Connected as ${integrations.github.login}`
                    : "Connected"
                  : "Not available"
                : "Checking…"}
            </span>
          </div>
          {integrations?.github.error && (
            <p className="warning-text small">{integrations.github.error}</p>
          )}
          <div className="settings-form-grid">
            <label>
              Repository
              <input
                value={repo}
                onChange={(event) => setRepo(event.target.value)}
                placeholder="owner/repository"
              />
            </label>
            <label>
              Projects v2 number <span className="optional">optional</span>
              <input
                type="number"
                min="1"
                step="1"
                value={projectNumber}
                onChange={(event) => setProjectNumber(event.target.value)}
                placeholder="1"
              />
            </label>
          </div>
          <div className="sync-row">
            <div>
              <strong>
                {sync?.state === "syncing"
                  ? "Sync in progress"
                  : sync?.state === "error"
                    ? "Sync needs attention"
                    : sync?.state === "conflict"
                      ? "Conflicts need resolution"
                      : "Issue & project sync"}
              </strong>
              <span>
                Last synced {timeAgo(sync?.lastSyncAt)} · {sync?.pending || 0}{" "}
                pending
              </span>
            </div>
            <button
              type="button"
              className="button small-button"
              disabled={!!busy || !project.repo || sync?.state === "syncing"}
              onClick={() =>
                void perform(
                  "sync",
                  () =>
                    api(`/projects/${pathId(project.id)}/sync`, "POST", {
                      direction: "both",
                    }),
                  "Sync queued. Updates will appear automatically.",
                )
              }
            >
              <RefreshCw size={13} />
              {busy === "sync" ? "Queuing…" : "Sync now"}
            </button>
            <button
              type="button"
              className="button subtle small-button"
              disabled={!!busy || !project.repo || sync?.state === "syncing"}
              onClick={() =>
                void perform(
                  "pull",
                  () =>
                    api(`/projects/${pathId(project.id)}/sync`, "POST", {
                      direction: "pull",
                    }),
                  "GitHub import queued.",
                )
              }
            >
              Pull only
            </button>
          </div>
          {sync?.error && <ErrorNotice>{sync.error}</ErrorNotice>}
          <p className="field-hint">
            Save connection changes before syncing. Existing linked tickets sync
            both ways; publish new issues explicitly from a ticket.
          </p>
          {projectNumber && (
            <div className="stage-mapping">
              <h3>Stage mapping</h3>
              <p className="field-hint">
                Map each local stage to a GitHub Project status. Sync once to
                discover available statuses.
              </p>
              {stages.map((stage) => (
                <label key={stage.id}>
                  <span>
                    <StageIcon stage={stage} />
                    {stage.name}
                  </span>
                  {project.statusOptions?.length ? (
                    <select
                      value={mapping[stage.id] || ""}
                      onChange={(event) =>
                        setMapping((current) => ({
                          ...current,
                          [stage.id]: event.target.value,
                        }))
                      }
                    >
                      <option value="">Not mapped</option>
                      {project.statusOptions.map((option) => (
                        <option value={option.id} key={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      aria-label={`GitHub status option ID for ${stage.name}`}
                      value={mapping[stage.id] || ""}
                      onChange={(event) =>
                        setMapping((current) => ({
                          ...current,
                          [stage.id]: event.target.value,
                        }))
                      }
                      placeholder="Status option ID"
                    />
                  )}
                </label>
              ))}
            </div>
          )}
        </section>
        <div className="settings-save">
          <button className="button primary" disabled={!!busy || !name.trim()}>
            <Save size={14} />
            {busy === "save" ? "Saving…" : "Save project settings"}
          </button>
        </div>
      </form>
      <section className="settings-section">
        <div className="section-title">
          <h2>Workflow stages</h2>
          <span className="muted small">{stages.length} stages</span>
        </div>
        <p className="field-hint">
          Use stages that reflect how your team works. Moving a ticket keeps its
          owner.
        </p>
        <div className="stage-editor-list">
          {stages.map((stage, index) => (
            <StageEditor
              key={stage.id}
              stage={stage}
              count={
                state.tickets.filter((ticket) => ticket.stageId === stage.id)
                  .length
              }
              index={index}
              total={stages.length}
              busy={!!busy}
              onSave={(fields) =>
                perform(
                  "stage",
                  () => api(`/stages/${pathId(stage.id)}`, "PATCH", fields),
                  "Stage updated.",
                )
              }
              onDelete={() =>
                perform(
                  "stage",
                  () => api(`/stages/${pathId(stage.id)}`, "DELETE"),
                  "Stage removed.",
                )
              }
              onMove={(direction) =>
                perform(
                  "stage",
                  async () => {
                    const reordered = [...stages];
                    [reordered[index], reordered[index + direction]] = [
                      reordered[index + direction],
                      reordered[index],
                    ];
                    for (
                      let position = 0;
                      position < reordered.length;
                      position++
                    ) {
                      if (reordered[position].position !== position)
                        await api(
                          `/stages/${pathId(reordered[position].id)}`,
                          "PATCH",
                          { position },
                        );
                    }
                  },
                  "Stage order updated.",
                )
              }
            />
          ))}
        </div>
        <NewStage
          projectId={project.id}
          position={
            stages.length
              ? Math.max(...stages.map((stage) => stage.position)) + 1
              : 0
          }
          busy={!!busy}
          onCreate={(fields) =>
            perform(
              "stage",
              () => api("/stages", "POST", fields),
              "Stage added.",
            )
          }
        />
      </section>
    </>
  );
}
function StageEditor({
  stage,
  count,
  index,
  total,
  busy,
  onSave,
  onDelete,
  onMove,
}: {
  stage: Stage;
  count: number;
  index: number;
  total: number;
  busy: boolean;
  onSave: (fields: Partial<Stage>) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  onMove: (direction: number) => Promise<boolean>;
}) {
  const [name, setName] = useState(stage.name);
  const [role, setRole] = useState(stage.role);
  const [autoStart, setAutoStart] = useState(!!stage.autoStart);
  const changed =
    name !== stage.name ||
    role !== stage.role ||
    autoStart !== !!stage.autoStart;
  return (
    <div className="stage-editor">
      <StageIcon stage={stage} />
      <input
        aria-label={`Stage name: ${stage.name}`}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <span className="count">{count}</span>
      <select
        aria-label={`Role for ${stage.name}`}
        value={role}
        onChange={(event) => setRole(event.target.value as StageRole)}
      >
        {(
          [
            "backlog",
            "planning",
            "active",
            "review",
            "done",
            "parked",
          ] as StageRole[]
        ).map((value) => (
          <option key={value} value={value}>
            {capitalize(value)}
          </option>
        ))}
      </select>
      <label
        className="checkbox-label auto-start"
        title="Start an assigned agent when a ticket enters this stage"
      >
        <input
          type="checkbox"
          checked={autoStart}
          onChange={(event) => setAutoStart(event.target.checked)}
        />
        Auto-start
      </label>
      <div className="stage-actions">
        {changed && (
          <button
            className="icon-button save-stage"
            aria-label={`Save ${stage.name}`}
            disabled={busy || !name.trim()}
            onClick={() => void onSave({ name: name.trim(), role, autoStart })}
          >
            <Check size={14} />
          </button>
        )}
        <button
          className="icon-button"
          aria-label={`Move ${stage.name} up`}
          disabled={busy || index === 0}
          onClick={() => void onMove(-1)}
        >
          <ArrowUp size={14} />
        </button>
        <button
          className="icon-button"
          aria-label={`Move ${stage.name} down`}
          disabled={busy || index === total - 1}
          onClick={() => void onMove(1)}
        >
          <ArrowDown size={14} />
        </button>
        <button
          className="icon-button"
          aria-label={`Delete ${stage.name}`}
          title={
            count
              ? "Move all tickets out of this stage before deleting it."
              : "Delete empty stage"
          }
          disabled={busy || count > 0}
          onClick={() => void onDelete()}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
function NewStage({
  projectId,
  position,
  busy,
  onCreate,
}: {
  projectId: string;
  position: number;
  busy: boolean;
  onCreate: (fields: Partial<Stage>) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  return (
    <form
      className="new-stage-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onCreate({
          projectId,
          name: name.trim(),
          position,
          role: "backlog",
        }).then((created) => {
          if (created) setName("");
        });
      }}
    >
      <Plus size={15} />
      <input
        aria-label="New stage name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Add a stage…"
      />
      <button className="button small-button" disabled={busy || !name.trim()}>
        Add stage
      </button>
    </form>
  );
}
