import { useState, type FormEvent } from "react";
import { Check, Github, Plus, RefreshCw, Save, Server } from "lucide-react";
import { api, errorMessage, pathId } from "../api";
import type { DeskState, Health, Integrations, Project } from "../types";
import { EmptyState, ErrorNotice, StageIcon, timeAgo } from "./shared";

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
        <p>Connect your repositories and inspect the shared workflow.</p>
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
          Create a project to configure its working directory and GitHub sync.
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
            <section
              className="github-discovered-statuses"
              aria-label="Discovered GitHub statuses"
            >
              <h3>Discovered GitHub statuses</h3>
              <p className="field-hint">
                Statuses match the fixed workflow by name. Sync validates every
                name; missing or ambiguous statuses require attention in GitHub.
              </p>
              {project.statusOptions?.length ? (
                <ul>
                  {project.statusOptions.map((option) => (
                    <li key={option.id}>{option.name}</li>
                  ))}
                </ul>
              ) : (
                <p className="field-hint">
                  No status metadata discovered yet. Sync the connected project
                  to check its statuses.
                </p>
              )}
            </section>
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
          Every project follows the same five stages. Moving a ticket keeps its
          owner. Blockers remain separate from stage, and assignment does not
          start work.
        </p>
        <ol className="fixed-workflow-list" aria-label="Fixed workflow stages">
          {stages.map((stage) => (
            <li key={stage.id}>
              <StageIcon stage={stage} />
              <strong>{stage.name}</strong>
              <span>
                {
                  state.tickets.filter(
                    (ticket) => ticket.stageId === stage.id && !ticket.archived,
                  ).length
                }{" "}
                tickets
              </span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
