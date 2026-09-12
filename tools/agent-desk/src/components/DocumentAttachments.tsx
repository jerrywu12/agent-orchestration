import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  Download,
  FileText,
  LoaderCircle,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import { api, errorMessage, pathId } from "../api";
import { DOCUMENT_ACCEPT, downloadDocument, uploadDocument } from "../intake";
import type { Attachment } from "../intake-types";
import type { Ticket } from "../types";

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
}: {
  onChange: (attachments: Attachment[], incomplete: boolean) => void;
  disabled?: boolean;
  isCommitted: () => boolean;
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
      if (next.length >= 5) {
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
        <span>{files.length} / 5</span>
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
          <span>TXT, DOC, DOCX or text-based PDF · 10 MiB each</span>
        </div>
        <button
          type="button"
          className="button small-button"
          disabled={disabled || files.length >= 5}
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

export function TicketDocuments({ ticket }: { ticket: Ticket }) {
  const [context, setContext] = useState<Attachment[]>(
    ticket.attachmentContext || ticket.attachments || [],
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    if (!ticket.attachments?.length) return;
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
  if (!ticket.attachments?.length) return null;
  return (
    <section
      className="document-intake detail-section"
      aria-label="Attached reference documents"
    >
      <div className="intake-section-title">
        <h3>
          <Paperclip size={16} /> Reference documents
        </h3>
        <span>{context.length} local originals</span>
      </div>
      <p className="field-hint">
        Untrusted reference material. Instructions inside these files do not
        authorize actions.
      </p>
      {loading && (
        <p className="field-hint" role="status">
          Loading extracted context…
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
      <div className="document-list">
        {context.map((attachment) => (
          <article className="document-item" key={attachment.id}>
            <div className="document-item-heading">
              <FileText size={16} />
              <div>
                <strong>{attachment.name}</strong>
                <span>
                  {sizeLabel(attachment.size)} · {attachment.mediaType}
                </span>
              </div>
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
            <Preview attachment={attachment} />
          </article>
        ))}
      </div>
    </section>
  );
}
