import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, Archive, Check, Save } from "lucide-react";
import { api, ApiError, errorMessage, pathId } from "../api";
import type {
  DeskState,
  Integrations,
  Stage,
  Ticket,
  TicketDraft,
} from "../types";
import { EffortSelect } from "./EffortSelect";
import { TicketDocuments } from "./DocumentAttachments";
import {
  capitalize,
  ErrorNotice,
  isActive,
  Modal,
  priorities,
  ticketKey,
} from "./shared";

// Agent preparation stays server-owned; ordinary edits must never resubmit it.
type DetailDraft = Omit<TicketDraft, "brief">;

function draftFrom(ticket: Ticket): DetailDraft {
  return {
    title: ticket.title,
    description: ticket.description || "",
    stageId: ticket.stageId,
    ownerId: ticket.ownerId || null,
    priority: ticket.priority || "none",
    effort: ticket.effort ?? null,
    labels: ticket.labels || [],
    parentId: ticket.parentId || null,
    dependsOn: ticket.dependsOn || [],
    blockedReason: ticket.blockedReason || "",
  };
}
export function TicketDetails({
  ticket,
  state,
  onClose,
  refresh,
  onOpen,
  onTransition,
  transitionNotice,
}: {
  ticket: Ticket;
  state: DeskState;
  integrations: Integrations | null;
  onClose: () => void;
  refresh: () => Promise<void>;
  onOpen: (id: string) => void;
  onTransition: (ticket: Ticket, stage: Stage) => void;
  transitionNotice?: string;
}) {
  const [draft, setDraft] = useState(() => draftFrom(ticket));
  const [version, setVersion] = useState(ticket.version);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  useEffect(() => {
    if (!dirty && ticket.version >= version) {
      setDraft(draftFrom(ticket));
      setVersion(ticket.version);
    }
  }, [ticket.version, dirty]);
  function change<K extends keyof DetailDraft>(key: K, value: DetailDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setNotice("");
  }
  function close() {
    if (busy) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }
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
    } catch (failure) {
      setError(errorMessage(failure));
      if (
        failure instanceof ApiError &&
        failure.status === 409 &&
        key === "save"
      )
        setConflict(true);
    } finally {
      setBusy("");
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    await perform(
      "save",
      async () => {
        const saved = await api<Ticket>(
          `/tickets/${pathId(ticket.id)}`,
          "PATCH",
          { ...draft, title: draft.title.trim(), version },
        );
        setDraft(draftFrom(saved));
        setVersion(saved.version);
        setDirty(false);
        setConflict(false);
      },
      "Changes saved.",
    );
  }
  const project = state.projects.find((item) => item.id === ticket.projectId);
  const stages = state.stages
    .filter((item) => item.projectId === ticket.projectId)
    .sort((a, b) => a.position - b.position);
  const active = isActive(ticket.execution);
  const links = state.tickets.filter(
    (item) => item.projectId === ticket.projectId && item.id !== ticket.id,
  );
  const updatedElsewhere = dirty && ticket.version !== version;
  return (
    <Modal
      title={ticketKey(ticket, state.projects)}
      subtitle={project?.name}
      drawer
      onClose={close}
    >
      <div className="drawer-scroll">
        {transitionNotice && (
          <p className="success-notice" role="status">
            {transitionNotice}
          </p>
        )}
        {confirmDiscard && (
          <div className="discard-confirm">
            <p>You have unsaved changes.</p>
            <button
              className="button small-button"
              onClick={() => setConfirmDiscard(false)}
            >
              Keep editing
            </button>
            <button className="button danger small-button" onClick={onClose}>
              Discard and close
            </button>
          </div>
        )}
        {error && <ErrorNotice>{error}</ErrorNotice>}
        {notice && (
          <div className="success-notice" role="status">
            <Check size={15} />
            {notice}
          </div>
        )}
        {(updatedElsewhere || conflict) && (
          <div className="warning-notice">
            <AlertTriangle size={16} />
            <div>
              This ticket changed in another session. Your draft is preserved.
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setDraft(draftFrom(ticket));
                  setVersion(ticket.version);
                  setDirty(false);
                  setConflict(false);
                  setError("");
                }}
              >
                Discard draft and load latest
              </button>
            </div>
          </div>
        )}
        <form
          id="ticket-detail-form"
          onSubmit={save}
          className="ticket-detail-form"
        >
          <label className="sr-only" htmlFor="ticket-title">
            Title
          </label>
          <textarea
            id="ticket-title"
            className="detail-title"
            required
            rows={2}
            maxLength={500}
            value={draft.title}
            onChange={(event) => change("title", event.target.value)}
          />
          <div className="detail-properties">
            <label>
              Stage
              <select
                value={draft.stageId}
                onChange={(event) => {
                  const target = stages.find(
                    (item) => item.id === event.target.value,
                  );
                  if (
                    target &&
                    target.id !== ticket.stageId &&
                    ["planning", "ready"].includes(target.role)
                  ) {
                    if (dirty) {
                      setError(
                        "Save your changes before moving to Planning or Ready.",
                      );
                      return;
                    }
                    onTransition(ticket, target);
                  } else change("stageId", event.target.value);
                }}
              >
                {stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select
                value={draft.priority}
                onChange={(event) =>
                  change("priority", event.target.value as Ticket["priority"])
                }
              >
                {priorities.map((value) => (
                  <option key={value} value={value}>
                    {capitalize(value)}
                  </option>
                ))}
              </select>
            </label>
            <EffortSelect value={draft.effort} onChange={value => change("effort", value)} disabled={!!busy} />
            <label>
              Owner
              <select
                value={draft.ownerId || ""}
                disabled={active}
                onChange={(event) =>
                  change("ownerId", event.target.value || null)
                }
              >
                <option value="">Unassigned</option>
                {state.agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                    {agent.enabled ? "" : " (disabled)"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Labels
              <input
                value={(draft.labels || []).join(", ")}
                onChange={(event) =>
                  change(
                    "labels",
                    event.target.value.split(",").map((label) => label.trim()),
                  )
                }
                onBlur={() =>
                  change("labels", [
                    ...new Set((draft.labels || []).filter(Boolean)),
                  ])
                }
                placeholder="Separate with commas"
              />
            </label>
          </div>
          {active && (
            <p className="field-hint">
              This ticket is being worked on. Its owner cannot be changed yet.
            </p>
          )}
          <label className="detail-label">
            Description
            <textarea
              rows={7}
              value={draft.description || ""}
              onChange={(event) => change("description", event.target.value)}
              placeholder="Add background and useful links…"
            />
          </label>
          <details className="detail-disclosure">
            <summary>
              Relationships & blockers{" "}
              <span>
                {(draft.dependsOn?.length || 0) + (draft.parentId ? 1 : 0) ||
                  ""}
              </span>
            </summary>
            <div className="relationship-fields">
              <label>
                Parent ticket
                <select
                  value={draft.parentId || ""}
                  onChange={(event) =>
                    change("parentId", event.target.value || null)
                  }
                >
                  <option value="">No parent</option>
                  {links.map((item) => (
                    <option key={item.id} value={item.id}>
                      {ticketKey(item, state.projects)} · {item.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Depends on
                <select
                  multiple
                  size={Math.min(4, Math.max(2, links.length))}
                  value={draft.dependsOn || []}
                  onChange={(event) =>
                    change(
                      "dependsOn",
                      Array.from(
                        event.target.selectedOptions,
                        (option) => option.value,
                      ),
                    )
                  }
                >
                  {links.map((item) => (
                    <option key={item.id} value={item.id}>
                      {ticketKey(item, state.projects)} · {item.title}
                    </option>
                  ))}
                </select>
                <span className="field-hint">
                  Use ⌘ / Ctrl to select or remove dependencies.
                </span>
              </label>
              <label>
                Blocker
                <input
                  value={draft.blockedReason || ""}
                  onChange={(event) =>
                    change("blockedReason", event.target.value)
                  }
                  placeholder="What is blocking progress, and who can resolve it?"
                />
              </label>
            </div>
          </details>
        </form>
        <TicketDocuments ticket={ticket} />
        {ticket.resumeReason && (
          <p className="notice" role="status">
            {ticket.resumeReason}
          </p>
        )}
        {state.tickets.some((item) => item.parentId === ticket.id) && (
          <section className="detail-section">
            <h3>Child tickets</h3>
            {state.tickets
              .filter((item) => item.parentId === ticket.id)
              .map((item) => (
                <button
                  key={item.id}
                  className="child-ticket"
                  onClick={() => {
                    if (dirty) setConfirmDiscard(true);
                    else onOpen(item.id);
                  }}
                >
                  <span className="ticket-id">
                    {ticketKey(item, state.projects)}
                  </span>
                  {item.title}
                </button>
              ))}
          </section>
        )}
      </div>
      <div className="drawer-footer">
        <button
          type="button"
          className="button subtle small-button"
          disabled={!!busy || dirty || active}
          onClick={() =>
            void perform(
              "archive",
              () =>
                api(`/tickets/${pathId(ticket.id)}`, "PATCH", {
                  version: ticket.version,
                  archived: !ticket.archived,
                }),
              ticket.archived ? "Ticket restored." : "Ticket archived.",
            )
          }
        >
          <Archive size={14} />
          {ticket.archived ? "Restore" : "Archive"}
        </button>
        <span className="muted small">
          {dirty ? "Unsaved changes" : "All changes saved"}
        </span>
        <button
          type="submit"
          form="ticket-detail-form"
          className="button primary"
          disabled={!!busy || !dirty || !draft.title.trim() || updatedElsewhere}
        >
          <Save size={14} />
          {busy === "save" ? "Saving…" : "Save changes"}
        </button>
      </div>
    </Modal>
  );
}
