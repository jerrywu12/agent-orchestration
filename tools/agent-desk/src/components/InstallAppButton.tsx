import { useId, useSyncExternalStore } from "react";
import { Check, Download } from "lucide-react";
import { pwa } from "../pwa";

export function InstallAppButton({
  className = "button subtle",
}: {
  className?: string;
}) {
  const state = useSyncExternalStore(
    pwa.subscribe,
    pwa.getSnapshot,
    pwa.getSnapshot,
  );
  const hintId = useId();
  const installed = state.status === "installed";
  const prompting = state.status === "prompting";
  return (
    <div>
      <button
        type="button"
        className={className}
        disabled={installed || prompting}
        aria-describedby={state.message ? hintId : undefined}
        onClick={() => void pwa.requestInstall()}
        title={
          installed
            ? "Agent Desk is installed. Its local service must be running."
            : undefined
        }
      >
        {installed ? (
          <Check size={15} aria-hidden="true" />
        ) : (
          <Download size={15} aria-hidden="true" />
        )}
        {installed
          ? "App installed"
          : prompting
            ? "Opening installer…"
            : state.status === "requested"
              ? "Install requested"
              : "Install app"}
      </button>
      {state.message && (
        <p id={hintId} className="field-hint" role="status">
          {state.message}
        </p>
      )}
    </div>
  );
}

export default InstallAppButton;
