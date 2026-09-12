import { useRef, useState, type FormEvent } from "react";
import { FolderPlus, Plus } from "lucide-react";
import { api, errorMessage } from "../api";
import type { DeskState, Priority, Project, Ticket } from "../types";
import { capitalize, ErrorNotice, Modal, priorities } from "./shared";
import type { Attachment, FolderInspection } from "../intake-types";
import { emptyBrief } from "../intake";
import { DocumentAttachments } from "./DocumentAttachments";
import { FolderPicker } from "./FolderPicker";
import { BriefFields } from "./WorkflowBrief";

export function CreateProject({
  onClose,
  onCreated,
  projects = [],
}: {
  onClose: () => void;
  onCreated: (project: Project) => Promise<void>;
  projects?: Project[];
}) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [path, setPath] = useState("");
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [folderBusy, setFolderBusy] = useState(false);
  const [inspection, setInspection] = useState<FolderInspection | null>(null);
  const touched = useRef({ name: false, key: false, repo: false });
  async function openExisting(id: string) {
    setBusy(true);
    setError("");
    try {
      const project =
        projects.find((item) => item.id === id) ||
        (await api<DeskState>("/state")).projects.find(
          (item) => item.id === id,
        );
      if (!project)
        throw new Error(
          "The existing project is no longer available. Refresh and inspect the folder again.",
        );
      await onCreated(project);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (path.trim() && inspection?.path !== path.trim()) {
      setError(
        "Inspect the working directory before registering this project.",
      );
      return;
    }
    if (inspection?.existingProjectId && inspection.path === path.trim()) {
      await openExisting(inspection.existingProjectId);
      return;
    }
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
        if (!busy && !folderBusy) onClose();
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
            onChange={(event) => {
              touched.current.name = true;
              setName(event.target.value);
            }}
            placeholder="e.g. Research tools"
          />
        </label>
        <label>
          Identifier <span className="optional">optional</span>
          <input
            value={key}
            onChange={(event) => {
              touched.current.key = true;
              setKey(event.target.value.toUpperCase());
            }}
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
            onChange={(event) => {
              setPath(event.target.value);
              setInspection(null);
            }}
            placeholder="/absolute/path/to/project"
          />
          <span className="field-hint">
            Agents need an existing local project directory to start.
          </span>
        </label>
        <FolderPicker
          path={path}
          disabled={busy}
          onBusy={setFolderBusy}
          onExisting={(id) => void openExisting(id)}
          onInspection={(result) => {
            setInspection(result);
            setPath(result.path);
            if (!touched.current.name) setName(result.name);
            if (!touched.current.key) setKey(result.key);
            if (!touched.current.repo) setRepo(result.repo);
          }}
        />
        <label>
          GitHub repository <span className="optional">optional</span>
          <input
            value={repo}
            onChange={(event) => {
              touched.current.repo = true;
              setRepo(event.target.value);
            }}
            placeholder="owner/repository"
          />
        </label>
        <div className="dialog-footer">
          <button
            type="button"
            className="button"
            onClick={onClose}
            disabled={busy || folderBusy}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || folderBusy || !name.trim()}
          >
            <FolderPlus size={15} />
            {busy
              ? "Opening…"
              : inspection?.existingProjectId
                ? "Open project"
                : "Create project"}
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
  const [brief, setBrief] = useState(emptyBrief);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [documentsIncomplete, setDocumentsIncomplete] = useState(false);
  const created = useRef<Ticket | null>(null);
  const [createdTicket, setCreatedTicket] = useState<Ticket | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stages = state.stages
    .filter((item) => item.projectId === project)
    .sort((a, b) => a.position - b.position);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (documentsIncomplete) return;
    setError("");
    setBusy(true);
    try {
      const ticket =
        created.current ||
        (await api<Ticket>("/tickets", "POST", {
          projectId: project,
          title: title.trim(),
          description,
          ownerId: owner || null,
          priority,
          brief,
          attachmentIds: attachments.map((attachment) => attachment.id),
          ...(stage ? { stageId: stage } : {}),
        }));
      created.current = ticket;
      setCreatedTicket(ticket);
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
        {createdTicket && (
          <p className="success-notice" role="status">
            Your ticket was created. Its documents and brief are saved. Open the
            created ticket to continue editing.
          </p>
        )}
        <fieldset
          className="ticket-creation-fields"
          disabled={busy || !!createdTicket}
        >
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
              placeholder="Add background and useful links…"
            />
          </label>
          <BriefFields value={brief} onChange={setBrief} disabled={busy} />
          <DocumentAttachments
            isCommitted={() => !!created.current}
            disabled={busy || !!created.current}
            onChange={(items, incomplete) => {
              setAttachments(items);
              setDocumentsIncomplete(incomplete);
            }}
          />
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
                onChange={(event) =>
                  setPriority(event.target.value as Priority)
                }
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
        </fieldset>
        <div className="dialog-footer">
          <button
            type="button"
            className="button"
            onClick={onClose}
            disabled={busy}
          >
            {createdTicket ? "Close" : "Cancel"}
          </button>
          <button
            className="button primary"
            disabled={busy || documentsIncomplete || !title.trim() || !project}
          >
            <Plus size={15} />
            {createdTicket
              ? busy
                ? "Opening…"
                : "Open created ticket"
              : busy
                ? "Creating…"
                : "Create ticket"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
