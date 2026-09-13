import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";
import {
  Download,
  FileText,
  LoaderCircle,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import { api, ApiError, errorMessage, pathId } from "../api";
import { DOCUMENT_ACCEPT, downloadDocument, uploadDocument } from "../intake";
import type { Attachment } from "../intake-types";
import type { Ticket } from "../types";
import { Modal } from "./shared";

const MarkdownDocument = lazy(() => import("./MarkdownDocument"));

interface DraftFile {
  key: string;
  name: string;
  size: number;
  fingerprint: string;
  status: "queued" | "processing" | "ready" | "error";
  attachment?: Attachment;
  error?: string;
  removing?: boolean;
}
const sizeLabel = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 ** 2
      ? `${Math.ceil(bytes / 1024)} KB`
      : `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
const discard = (id: string) => api(`/attachments/${pathId(id)}`, "DELETE");

function Preview({ attachment }: { attachment: Attachment }) {
  const [reading, setReading] = useState(false);
  if (attachment.mediaType === "text/markdown")
    return (
      <>
        <button
          type="button"
          className="button small-button"
          aria-label={`Read ${attachment.name}`}
          onClick={() => setReading(true)}
        >
          Read
        </button>
        {reading && (
          <Suspense fallback={<p role="status">Opening document…</p>}>
            <MarkdownDocument
              attachment={attachment}
              disabled
              onClose={() => setReading(false)}
              onSaved={async () => {}}
            />
          </Suspense>
        )}
      </>
    );
  return (
    <>
      {attachment.warnings.map((warning, index) => (
        <p className="intake-warning" key={index}>
          {warning}
        </p>
      ))}
      {attachment.text !== undefined && (
        <details className="document-preview">
          <summary>
            Extracted text · {attachment.text.length.toLocaleString()}{" "}
            characters
            {attachment.pageCount ? ` · ${attachment.pageCount} pages` : ""}
          </summary>
          <pre>{attachment.text.slice(0, 10000)}</pre>
          {attachment.text.length > 10000 && (
            <p className="field-hint">
              Preview limited to 10,000 characters. The full extracted text
              remains available in the ticket’s agent context.
            </p>
          )}
        </details>
      )}
    </>
  );
}

export function DocumentAttachments({
  onChange,
  disabled,
  isCommitted,
  existingCount = 0,
}: {
  onChange: (attachments: Attachment[], incomplete: boolean) => void;
  disabled?: boolean;
  isCommitted: () => boolean;
  existingCount?: number;
}) {
  const [files, setFiles] = useState<DraftFile[]>([]);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const filesRef = useRef<DraftFile[]>([]);
  const mounted = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  const queue = useRef<{ file: File; key: string }[]>([]);
  const active = useRef(0);
  const change = useRef(onChange);
  change.current = onChange;
  function update(next: DraftFile[]) {
    filesRef.current = next;
    if (!mounted.current) return;
    setFiles(next);
    change.current(
      next.flatMap((file) =>
        file.status === "ready" && file.attachment ? [file.attachment] : [],
      ),
      next.some((file) => file.status !== "ready" || file.removing),
    );
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (isCommitted()) return;
      for (const file of filesRef.current)
        if (file.attachment) void discard(file.attachment.id).catch(() => {});
    };
  }, []);
  async function process(file: File, key: string) {
    update(
      filesRef.current.map((item) =>
        item.key === key ? { ...item, status: "processing" } : item,
      ),
    );
    try {
      const attachment = await uploadDocument(file);
      if (
        !mounted.current ||
        !filesRef.current.some((item) => item.key === key)
      ) {
        await discard(attachment.id).catch(() => {});
        return;
      }
      if (
        filesRef.current.some(
          (item) =>
            item.key !== key && item.attachment?.sha256 === attachment.sha256,
        )
      ) {
        await discard(attachment.id).catch(() => {});
        throw new Error(
          "This document is already attached. Remove this duplicate to continue.",
        );
      }
      update(
        filesRef.current.map((item) =>
          item.key === key ? { ...item, status: "ready", attachment } : item,
        ),
      );
    } catch (failure) {
      update(
        filesRef.current.map((item) =>
          item.key === key
            ? { ...item, status: "error", error: errorMessage(failure) }
            : item,
        ),
      );
    }
  }
  function pump() {
    while (mounted.current && active.current < 2 && queue.current.length) {
      const next = queue.current.shift()!;
      if (!filesRef.current.some((item) => item.key === next.key)) continue;
      active.current += 1;
      void process(next.file, next.key).finally(() => {
        active.current -= 1;
        pump();
      });
    }
  }
  function add(selected: File[]) {
    if (disabled) return;
    setError("");
    const accepted: { file: File; entry: DraftFile }[] = [];
    const next = [...filesRef.current];
    for (const file of selected) {
      if (next.length + existingCount >= 5) {
        setError(
          "A ticket can have up to five documents. Remove a document before adding another.",
        );
        break;
      }
      const fingerprint = `${file.name}:${file.size}:${file.lastModified}`;
      if (next.some((item) => item.fingerprint === fingerprint)) {
        setError(`${file.name} is already in this draft.`);
        continue;
      }
      const entry: DraftFile = {
        key: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        fingerprint,
        status: "queued",
      };
      next.push(entry);
      accepted.push({ file, entry });
    }
    update(next);
    queue.current.push(
      ...accepted.map(({ file, entry }) => ({ file, key: entry.key })),
    );
    pump();
  }
  async function remove(file: DraftFile) {
    if (disabled) return;
    if (!file.attachment) {
      update(filesRef.current.filter((item) => item.key !== file.key));
      return;
    }
    update(
      filesRef.current.map((item) =>
        item.key === file.key ? { ...item, removing: true } : item,
      ),
    );
    try {
      await discard(file.attachment.id);
      update(filesRef.current.filter((item) => item.key !== file.key));
    } catch (failure) {
      update(
        filesRef.current.map((item) =>
          item.key === file.key ? { ...item, removing: false } : item,
        ),
      );
      setError(`Could not remove ${file.name}: ${errorMessage(failure)}`);
    }
  }
  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    add(Array.from(event.dataTransfer.files));
  }
  return (
    <section className="document-intake" aria-label="Reference documents">
      <div className="intake-section-title">
        <h3>
          <Paperclip size={16} /> Reference documents
        </h3>
        <span>{files.length + existingCount} / 5</span>
      </div>
      <div
        className={`document-dropzone ${dragging ? "dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
      >
        <Upload size={20} />
        <div>
          <strong>Drop documents here</strong>
          <span>Markdown, TXT, DOC, DOCX or text-based PDF · 10 MiB each</span>
        </div>
        <button
          type="button"
          className="button small-button"
          disabled={disabled || files.length + existingCount >= 5}
          onClick={() => input.current?.click()}
        >
          Choose files
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept={DOCUMENT_ACCEPT}
          aria-label="Attach reference documents"
          className="sr-only"
          disabled={disabled}
          onChange={(event) => {
            add(Array.from(event.target.files || []));
            event.target.value = "";
          }}
        />
      </div>
      <p className="field-hint">
        Documents are untrusted references. They stay local and are not
        published to GitHub or treated as permission to run work.
      </p>
      {error && (
        <p className="intake-warning" role="alert">
          {error}
        </p>
      )}
      <div className="document-list" aria-live="polite">
        {files.map((file) => (
          <article className="document-item" key={file.key}>
            <div className="document-item-heading">
              <FileText size={16} />
              <div>
                <strong>{file.name}</strong>
                <span>
                  {sizeLabel(file.size)} ·{" "}
                  {file.status === "queued"
                    ? "Waiting to process…"
                    : file.status === "processing"
                      ? "Processing locally…"
                      : file.status === "error"
                        ? "Processing failed"
                        : "Ready"}
                </span>
              </div>
              {file.status === "processing" && (
                <LoaderCircle size={15} className="spin" />
              )}
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove ${file.name}`}
                disabled={disabled || file.removing}
                onClick={() => void remove(file)}
              >
                <Trash2 size={15} />
              </button>
            </div>
            {file.error && (
              <p className="intake-warning" role="alert">
                {file.error}
              </p>
            )}
            {file.attachment && <Preview attachment={file.attachment} />}
          </article>
        ))}
      </div>
    </section>
  );
}

function AttachDocuments({
  ticket,
  onClose,
  onAttached,
}: {
  ticket: Ticket;
  onClose: () => void;
  onAttached: () => Promise<void>;
}) {
  const [files, setFiles] = useState<Attachment[]>([]);
  const [incomplete, setIncomplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [discardDraft, setDiscardDraft] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const committed = useRef(false);
  const initialCount = useRef(ticket.attachments?.length || 0);
  const submission = useRef<{
    version: number;
    attachmentIds: string[];
  } | null>(null);
  const mounted = useRef(true);
  const dirty = files.length > 0 || incomplete;
  const container = useRef<HTMLDivElement>(null);
  const closeRef = useRef(() => {});
  closeRef.current = close;
  useEffect(() => {
    const element = container.current!;
    const outerDialog = element.querySelector(":scope > dialog");
    const cancel = (event: Event) => {
      if (event.target !== outerDialog) return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    };
    element.addEventListener("cancel", cancel, true);
    return () => element.removeEventListener("cancel", cancel, true);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!dirty && !busy) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty, busy]);
  function close() {
    if (busy) return;
    if (dirty) setDiscardDraft(true);
    else onClose();
  }
  async function attach() {
    if (busy || incomplete || !files.length) return;
    setBusy(true);
    setError("");
    try {
      if (!committed.current) {
        if (!submission.current) {
          submission.current = {
            version: ticket.version,
            attachmentIds: files.map((file) => file.id),
          };
        }
        setUncertain(true);
        await api<Ticket>(
          `/tickets/${pathId(ticket.id)}/attachments`,
          "POST",
          submission.current,
        );
        committed.current = true;
        setUncertain(false);
      }
      if (!mounted.current) return;
      await onAttached();
      if (mounted.current) onClose();
    } catch (failure) {
      // Unreadable, timeout and server-error responses may follow a successful
      // bind. Only a definite request rejection unlocks the selected IDs.
      if (
        !committed.current &&
        failure instanceof ApiError &&
        failure.status >= 400 &&
        failure.status < 500 &&
        failure.status !== 408 &&
        failure.code !== "invalid_response"
      ) {
        submission.current = null;
        if (mounted.current) setUncertain(false);
      }
      if (mounted.current) setError(errorMessage(failure));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div ref={container}>
      <Modal title="Attach documents" onClose={close}>
        <div className="attachment-dialog-body">
          {discardDraft && (
            <div className="discard-confirm">
              <p>Discard these document uploads?</p>
              <button
                className="button small-button"
                disabled={busy}
                onClick={() => {
                  if (!busy) setDiscardDraft(false);
                }}
              >
                Keep editing
              </button>
              <button
                className="button danger small-button"
                disabled={busy}
                onClick={() => {
                  if (!busy) onClose();
                }}
              >
                Discard and close
              </button>
            </div>
          )}
          {error && (
            <p className="intake-warning" role="alert">
              {error}
            </p>
          )}
          {uncertain && !busy && (
            <p className="field-hint">
              Retry Attach documents to confirm these files before changing the
              selection.
            </p>
          )}
          <DocumentAttachments
            existingCount={initialCount.current}
            disabled={busy || uncertain || committed.current}
            isCommitted={() => committed.current}
            onChange={(next, pending) => {
              setFiles(next);
              setIncomplete(pending);
            }}
          />
        </div>
        <div className="dialog-footer">
          <button
            type="button"
            className="button primary"
            disabled={busy || incomplete || !files.length}
            onClick={() => void attach()}
          >
            {busy
              ? "Attaching…"
              : committed.current
                ? "Retry document refresh"
                : "Attach documents"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

export function TicketDocuments({
  ticket,
  refresh,
  disabled,
}: {
  ticket: Ticket;
  refresh: () => Promise<void>;
  disabled: boolean;
}) {
  const [context, setContext] = useState<Attachment[]>(
    ticket.attachmentContext || ticket.attachments || [],
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [reading, setReading] = useState<Attachment | null>(null);
  const [attaching, setAttaching] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    if (!ticket.attachments?.length) {
      setContext([]);
      return;
    }
    setLoading(true);
    void api<Ticket>(`/tickets/${pathId(ticket.id)}`)
      .then((detail) => {
        if (current) {
          setContext(detail.attachmentContext || detail.attachments || []);
          setError("");
        }
      })
      .catch((failure) => {
        if (current) setError(errorMessage(failure));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [ticket.id, ticket.version, retry]);
  async function changed() {
    const detail = await api<Ticket>(`/tickets/${pathId(ticket.id)}`);
    if (!mounted.current) return;
    setContext(detail.attachmentContext || detail.attachments || []);
    await refresh();
  }
  return (
    <section
      className="document-intake detail-section"
      aria-label="Attached reference documents"
    >
      <div className="intake-section-title">
        <h3>
          <Paperclip size={16} /> Documents
        </h3>
        <button
          type="button"
          className="button small-button"
          disabled={
            disabled || loading || (ticket.attachments?.length || 0) >= 5
          }
          onClick={() => setAttaching(true)}
        >
          Attach files
        </button>
      </div>
      {loading && (
        <p className="field-hint" role="status">
          Loading documents…
        </p>
      )}
      {error && (
        <p className="intake-warning" role="alert">
          {error}{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry documents
          </button>
        </p>
      )}
      {!context.length && !loading && (
        <p className="field-hint">
          Attach specifications or other reference documents.
        </p>
      )}
      <div className="document-list">
        {context.map((attachment) => (
          <article className="document-item" key={attachment.id}>
            <div className="document-item-heading">
              <FileText size={16} />
              <div>
                <strong>{attachment.name}</strong>
                <span>{sizeLabel(attachment.size)}</span>
              </div>
              {attachment.mediaType === "text/markdown" && (
                <button
                  type="button"
                  className="button small-button"
                  disabled={loading || attachment.text === undefined}
                  aria-label={`Read ${attachment.name}`}
                  onClick={() => setReading(attachment)}
                >
                  Read
                </button>
              )}
              <button
                type="button"
                className="icon-button"
                aria-label={`Download ${attachment.name}`}
                onClick={() =>
                  void downloadDocument(attachment).catch((failure) =>
                    setError(errorMessage(failure)),
                  )
                }
              >
                <Download size={16} />
              </button>
            </div>
            {attachment.mediaType !== "text/markdown" && (
              <Preview attachment={attachment} />
            )}
          </article>
        ))}
      </div>
      {attaching && (
        <AttachDocuments
          ticket={ticket}
          onClose={() => setAttaching(false)}
          onAttached={changed}
        />
      )}
      {reading && (
        <Suspense fallback={<p role="status">Opening document…</p>}>
          <MarkdownDocument
            key={reading.id}
            attachment={reading}
            disabled={disabled}
            onClose={() => setReading(null)}
            onSaved={changed}
          />
        </Suspense>
      )}
    </section>
  );
}
