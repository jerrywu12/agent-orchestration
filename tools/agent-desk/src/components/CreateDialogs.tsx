import { useState, type FormEvent } from "react";
import { FolderPlus, Plus } from "lucide-react";
import { api, errorMessage } from "../api";
import type { DeskState, Priority, Project, Ticket } from "../types";
import { capitalize, ErrorNotice, Modal, priorities } from "./shared";

export function CreateProject({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (project: Project) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [path, setPath] = useState("");
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const project = await api<Project>("/projects", "POST", {
        name: name.trim(),
        ...(key.trim() ? { key: key.trim().toUpperCase() } : {}),
        ...(path.trim() ? { path: path.trim() } : {}),
        ...(repo.trim() ? { repo: repo.trim() } : {}),
      });
      await onCreated(project);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Create a project"
      subtitle="A place for work to happen"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit} className="dialog-form">
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <label>
          Project name
          <input
            autoFocus
            required
            maxLength={160}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Research tools"
          />
        </label>
        <label>
          Identifier <span className="optional">optional</span>
          <input
            value={key}
            onChange={(event) => setKey(event.target.value.toUpperCase())}
            maxLength={12}
            placeholder="RESEARCH"
          />
          <span className="field-hint">
            A short prefix for ticket numbers. Generated if empty.
          </span>
        </label>
        <label>
          Working directory <span className="optional">optional</span>
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/absolute/path/to/project"
          />
          <span className="field-hint">
            Agents need an existing local project directory to start.
          </span>
        </label>
        <label>
          GitHub repository <span className="optional">optional</span>
          <input
            value={repo}
            onChange={(event) => setRepo(event.target.value)}
            placeholder="owner/repository"
          />
        </label>
        <div className="dialog-footer">
          <button
            type="button"
            className="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button className="button primary" disabled={busy || !name.trim()}>
            <FolderPlus size={15} />
            {busy ? "Creating…" : "Create project"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function CreateTicket({
  state,
  projectId,
  stageId,
  onClose,
  onCreated,
}: {
  state: DeskState;
  projectId?: string;
  stageId?: string;
  onClose: () => void;
  onCreated: (ticket: Ticket) => Promise<void>;
}) {
  const [project, setProject] = useState(
    projectId || state.projects[0]?.id || "",
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [stage, setStage] = useState(stageId || "");
  const [owner, setOwner] = useState("");
  const [priority, setPriority] = useState<Priority>("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stages = state.stages
    .filter((item) => item.projectId === project)
    .sort((a, b) => a.position - b.position);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const ticket = await api<Ticket>("/tickets", "POST", {
        projectId: project,
        title: title.trim(),
        description,
        ownerId: owner || null,
        priority,
        ...(stage ? { stageId: stage } : {}),
      });
      await onCreated(ticket);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="New ticket"
      subtitle="Make the next step clear"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit} className="dialog-form">
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <label>
          Project
          <select
            value={project}
            onChange={(event) => {
              setProject(event.target.value);
              setStage("");
            }}
          >
            {state.projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title
          <input
            autoFocus
            required
            maxLength={500}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What needs to be done?"
          />
        </label>
        <label>
          Description <span className="optional">optional</span>
          <textarea
            rows={5}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Add context, acceptance criteria, and useful links…"
          />
        </label>
        <div className="form-grid">
          <label>
            Stage
            <select
              value={stage}
              onChange={(event) => setStage(event.target.value)}
            >
              <option value="">Default stage</option>
              {stages.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value as Priority)}
            >
              {priorities.map((item) => (
                <option key={item} value={item}>
                  {capitalize(item)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Owner
          <select
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
          >
            <option value="">Unassigned</option>
            {state.agents.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {!item.enabled ? " (disabled)" : ""}
              </option>
            ))}
          </select>
          <span className="field-hint">
            Assignment records responsibility. Start an agent explicitly from
            the ticket.
          </span>
        </label>
        <div className="dialog-footer">
          <button
            type="button"
            className="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || !title.trim() || !project}
          >
            <Plus size={15} />
            {busy ? "Creating…" : "Create ticket"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
