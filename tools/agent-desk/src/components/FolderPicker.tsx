import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  Folder,
  FolderOpen,
  GitBranch,
  LoaderCircle,
} from "lucide-react";
import { errorMessage } from "../api";
import { intakeRequest } from "../intake";
import type { FolderInspection, FolderListing } from "../intake-types";

export function FolderPicker({
  path,
  disabled,
  onInspection,
  onExisting,
  onBusy,
}: {
  path: string;
  disabled?: boolean;
  onInspection: (inspection: FolderInspection) => void;
  onExisting: (id: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [inspection, setInspection] = useState<FolderInspection | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const sequence = useRef(0);
  const currentPath = useRef(path);
  currentPath.current = path;
  useEffect(
    () => () => {
      sequence.current += 1;
    },
    [],
  );
  const shownInspection = inspection?.path === path ? inspection : null;
  async function operation<T>(
    kind: string,
    request: () => Promise<T>,
    accept: (value: T) => void,
  ) {
    const requestId = ++sequence.current;
    setBusy(kind);
    onBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await request();
      if (sequence.current === requestId) accept(value);
    } catch (failure) {
      if (sequence.current === requestId) setError(errorMessage(failure));
    } finally {
      if (sequence.current === requestId) {
        setBusy("");
        onBusy(false);
      }
    }
  }
  function browse(directory = path) {
    setBrowsing(true);
    setListing(null);
    void operation(
      "browse",
      () =>
        intakeRequest<FolderListing>(
          `/project-folders${directory.trim() ? `?path=${encodeURIComponent(directory.trim())}` : ""}`,
        ),
      (result) => {
        setListing(result);
      },
    );
  }
  function apply(result: FolderInspection) {
    setInspection(result);
    onInspection(result);
    setBrowsing(false);
  }
  function inspect(directory: string) {
    const before = currentPath.current;
    void operation(
      "inspect",
      () =>
        intakeRequest<FolderInspection>("/projects/inspect", {
          path: directory,
        }),
      (result) => {
        if (currentPath.current === before) apply(result);
        else
          setNotice(
            "The working directory changed while inspection was running. Inspect the current path to continue.",
          );
      },
    );
  }
  function cancelSelection() {
    // Listing/inspection are read-only; fence their late results without
    // making the user wait for a pending request to release the form.
    sequence.current += 1;
    setBrowsing(false);
    setListing(null);
    setBusy("");
    onBusy(false);
    setError("");
    setNotice("Folder selection cancelled. Your form is unchanged.");
  }
  return (
    <div className="folder-picker">
      <div className="folder-actions">
        <button
          type="button"
          className="button small-button"
          disabled={disabled || !!busy}
          onClick={() => browse()}
        >
          <FolderOpen size={15} />
          Choose folder
        </button>
        <button
          type="button"
          className="text-button"
          disabled={disabled || !!busy || !path.trim()}
          onClick={() => inspect(path.trim())}
        >
          Inspect path
        </button>
      </div>
      {busy && (
        <p className="field-hint" role="status">
          <LoaderCircle size={14} className="spin" />
          {busy === "inspect"
            ? "Inspecting the existing folder…"
            : "Loading server folders…"}
        </p>
      )}
      {notice && (
        <p className="field-hint" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="intake-warning" role="alert">
          {error} Check the server path and choose a folder again.
        </p>
      )}
      {browsing && (
        <section className="folder-browser" aria-label="Server folder browser">
          <div className="folder-browser-heading">
            <strong>Server folders</strong>
            <button
              type="button"
              className="text-button"
              onClick={cancelSelection}
            >
              Close browser
            </button>
          </div>
          {listing && (
            <>
              <code className="folder-current-path">{listing.path}</code>
              <div className="folder-actions">
                <button
                  type="button"
                  className="button small-button"
                  disabled={!listing.parentPath || !!busy}
                  onClick={() => browse(listing.parentPath || "")}
                >
                  <ArrowUp size={14} />
                  Parent folder
                </button>
                <button
                  type="button"
                  className="button primary small-button"
                  disabled={!!busy}
                  onClick={() => inspect(listing.path)}
                >
                  Use this folder
                </button>
              </div>
              <ul className="folder-directory-list">
                {listing.directories.map((directory) => (
                  <li key={directory.path}>
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => browse(directory.path)}
                    >
                      <Folder size={15} />
                      <span>{directory.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {!listing.directories.length && (
                <p className="field-hint">No visible subfolders.</p>
              )}
              {listing.truncated && (
                <p className="field-hint">
                  Showing the first 200 folders. Enter a full server path to
                  inspect another directory.
                </p>
              )}
            </>
          )}
        </section>
      )}
      {shownInspection && (
        <section className="folder-inspection" aria-label="Folder inspection">
          <div className="intake-section-title">
            <strong>
              <Check size={15} />
              Folder inspected
            </strong>
            <span>
              {shownInspection.git.isRepository
                ? "Existing Git repository"
                : "Non-Git folder"}
            </span>
          </div>
          <code>{shownInspection.path}</code>
          {shownInspection.git.isRepository && (
            <p>
              <GitBranch size={14} />
              {shownInspection.git.branch || "Detached or unborn HEAD"} ·{" "}
              {shownInspection.git.hasHead
                ? "Commit history present"
                : "No initial commit"}{" "}
              ·{" "}
              {shownInspection.git.dirty
                ? "Uncommitted changes present"
                : "Clean working tree"}
            </p>
          )}
          {shownInspection.repo && <p>GitHub: {shownInspection.repo}</p>}
          {shownInspection.warnings.map((warning, index) => (
            <p className="intake-warning" key={index}>
              {warning}
            </p>
          ))}
          <p className="field-hint">
            This registers the existing folder. No clone, initialization,
            checkout, or file changes are performed.
          </p>
          {shownInspection.existingProjectId && (
            <button
              type="button"
              className="button primary"
              disabled={disabled}
              onClick={() => onExisting(shownInspection.existingProjectId!)}
            >
              Open existing project
            </button>
          )}
        </section>
      )}
    </div>
  );
}
