import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { X } from "lucide-react";
import { api, ApiError, errorMessage, pathId } from "../api";
import { downloadDocument } from "../intake";
import type { Attachment } from "../intake-types";

const safeUrl = (url: string) => (/^(https?:\/\/|#)/i.test(url) ? url : "");
function headingText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? headingText(child.props.children)
        : typeof child === "string" || typeof child === "number"
          ? String(child)
          : "",
    )
    .join("");
}
const headingId = (children: ReactNode) =>
  headingText(children)
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");

export default function MarkdownDocument({
  attachment,
  disabled,
  onClose,
  onSaved,
}: {
  attachment: Attachment;
  disabled: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  // This snapshot belongs to this editor. Parent polling must not replace its draft/hash.
  const [saved, setSaved] = useState(attachment);
  const [draft, setDraft] = useState(attachment.text || "");
  const [mode, setMode] = useState<"read" | "edit" | "preview">("read");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [discard, setDiscard] = useState<"close" | "reload" | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(true);
  const titleId = useId();
  const dirty = draft !== (saved.text || "");
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    return () => {
      mounted.current = false;
      element.close();
      previous?.focus();
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
    if (dirty) setDiscard("close");
    else onClose();
  }
  async function reload() {
    setBusy(true);
    setError("");
    try {
      const fresh = await api<Attachment>(`/attachments/${pathId(saved.id)}`);
      if (!mounted.current) return;
      setSaved(fresh);
      setDraft(fresh.text || "");
      setMode("read");
      setConflict(false);
      setDiscard(null);
      setNotice("");
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function save() {
    if (
      busy ||
      disabled ||
      !dirty ||
      !draft.trim() ||
      draft.length > 200000 ||
      conflict
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const fresh = await api<Attachment>(
        `/attachments/${pathId(saved.id)}`,
        "PATCH",
        { expectedSha256: saved.sha256, text: draft },
      );
      if (!mounted.current) return;
      setSaved(fresh);
      setDraft(fresh.text || "");
      setMode("read");
      setConflict(false);
      setNotice("Document saved.");
      await onSaved();
    } catch (failure) {
      if (mounted.current) {
        setError(errorMessage(failure));
        if (
          failure instanceof ApiError &&
          failure.code === "ATTACHMENT_CONFLICT"
        )
          setConflict(true);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="dialog markdown-dialog"
      aria-labelledby={titleId}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          close();
      }}
    >
      <div className="dialog-heading">
        <h2 id={titleId}>{saved.name}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close document"
          disabled={busy}
          onClick={close}
        >
          <X size={19} />
        </button>
      </div>
      <div className="markdown-toolbar">
        <button
          type="button"
          className="button small-button"
          disabled={busy || disabled}
          onClick={() => setMode("edit")}
        >
          Edit
        </button>
        {mode !== "read" && (
          <button
            type="button"
            className="button small-button"
            disabled={busy}
            onClick={() => setMode(mode === "preview" ? "edit" : "preview")}
          >
            {mode === "preview" ? "Source" : "Preview"}
          </button>
        )}
        <button
          type="button"
          className="button primary small-button"
          disabled={
            busy ||
            disabled ||
            !dirty ||
            !draft.trim() ||
            draft.length > 200000 ||
            conflict
          }
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="button small-button"
          disabled={busy}
          onClick={() => {
            if (dirty) setDiscard("reload");
            else void reload();
          }}
        >
          Reload document
        </button>
        <button
          type="button"
          className="button small-button"
          disabled={busy}
          onClick={() =>
            void downloadDocument(saved).catch((failure) =>
              setError(errorMessage(failure)),
            )
          }
        >
          Download
        </button>
      </div>
      <div className="markdown-scroll">
        {discard && (
          <div className="discard-confirm" role="alert">
            <p>Discard unsaved document changes?</p>
            <button
              type="button"
              className="button small-button"
              disabled={busy}
              onClick={() => setDiscard(null)}
            >
              Keep editing
            </button>
            <button
              type="button"
              className="button danger small-button"
              disabled={busy}
              onClick={() => (discard === "close" ? onClose() : void reload())}
            >
              {discard === "close" ? "Discard and close" : "Discard and reload"}
            </button>
          </div>
        )}
        {error && (
          <p className="intake-warning" role="alert">
            {error}
            {conflict &&
              " Your draft is preserved. Reload the document only when you are ready to discard it."}
          </p>
        )}
        {notice && (
          <p className="success-notice" role="status">
            {notice}
          </p>
        )}
        {mode === "edit" ? (
          <label className="markdown-editor-label">
            Markdown source
            <textarea
              aria-label="Markdown source"
              className="markdown-source"
              value={draft}
              readOnly={busy}
              spellCheck={false}
              onChange={(event) => {
                setDraft(event.target.value);
                setNotice("");
              }}
            />
            <span
              className={
                draft.length > 200000 ? "intake-warning" : "field-hint"
              }
            >
              {draft.length.toLocaleString()} / 200,000 characters
              {dirty ? " · Unsaved changes" : ""}
            </span>
          </label>
        ) : (
          <article className="markdown-content" aria-label="Markdown document">
            <Markdown
              remarkPlugins={[remarkGfm]}
              skipHtml
              urlTransform={safeUrl}
              components={{
                h1: ({ children }) => (
                  <h1 id={headingId(children)}>{children}</h1>
                ),
                h2: ({ children }) => (
                  <h2 id={headingId(children)}>{children}</h2>
                ),
                h3: ({ children }) => (
                  <h3 id={headingId(children)}>{children}</h3>
                ),
                h4: ({ children }) => (
                  <h4 id={headingId(children)}>{children}</h4>
                ),
                h5: ({ children }) => (
                  <h5 id={headingId(children)}>{children}</h5>
                ),
                h6: ({ children }) => (
                  <h6 id={headingId(children)}>{children}</h6>
                ),
                img: ({ alt }) => (
                  <span className="markdown-image-note">
                    [Image: {alt || "external image"}]
                  </span>
                ),
                a: ({ href, children }) =>
                  href ? (
                    <a
                      href={href}
                      target={href.startsWith("#") ? undefined : "_blank"}
                      rel="noopener noreferrer"
                    >
                      {children}
                    </a>
                  ) : (
                    <span>{children}</span>
                  ),
              }}
            >
              {mode === "preview" ? draft : saved.text || ""}
            </Markdown>
          </article>
        )}
      </div>
    </dialog>
  );
}
