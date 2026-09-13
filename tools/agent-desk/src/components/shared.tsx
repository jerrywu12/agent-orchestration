import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  Check,
  Circle,
  CircleDashed,
  CircleDot,
  Clock3,
  Inbox,
  SignalHigh,
  SignalLow,
  SignalMedium,
  X,
} from "lucide-react";
import type {
  Agent,
  Execution,
  Priority,
  Project,
  Stage,
  Ticket,
} from "../types";

export const priorities: Priority[] = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
];
export const capitalize = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1);
export function timeAgo(value?: string | null) {
  if (!value) return "Not yet";
  const elapsed = Date.now() - Date.parse(value);
  if (!Number.isFinite(elapsed)) return "Unknown time";
  const minutes = Math.max(0, Math.floor(elapsed / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}
export function ticketKey(ticket: Ticket, projects: Project[]) {
  const project = projects.find((item) => item.id === ticket.projectId);
  return `${project?.key || "TASK"}-${ticket.number}`;
}
export function safeUrl(url?: string | null) {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol)
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function isActive(execution?: Execution | null) {
  return (
    !!execution &&
    !execution.releasedAt &&
    !["complete", "completed", "failed", "stopped"].includes(execution.state)
  );
}
export function isStale(execution?: Execution | null) {
  return (
    isActive(execution) &&
    (!Number.isFinite(Date.parse(execution?.heartbeatAt || "")) ||
      Date.now() - Date.parse(execution?.heartbeatAt || "") > 90000)
  );
}
export function colorStyle(color?: string | null): CSSProperties {
  return {
    "--item-color":
      color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : "#758176",
  } as CSSProperties;
}
export function AgentAvatar({
  agent,
  small = false,
}: {
  agent?: Agent;
  small?: boolean;
}) {
  return (
    <span
      className={`avatar ${small ? "avatar-small" : ""} ${agent ? "" : "avatar-unassigned"}`}
      style={colorStyle(agent?.color)}
      aria-hidden="true"
    >
      {agent?.name?.slice(0, 2).toUpperCase() || "–"}
    </span>
  );
}
export function StageIcon({ stage }: { stage?: Stage }) {
  const Icon =
    stage?.role === "done"
      ? Check
      : stage?.role === "active"
        ? CircleDot
        : stage?.role === "backlog"
          ? CircleDashed
          : stage?.role === "review"
            ? Clock3
            : Circle;
  return (
    <Icon
      className="stage-icon"
      size={15}
      style={colorStyle(stage?.color)}
      aria-hidden="true"
    />
  );
}
export function PriorityIcon({ priority }: { priority?: Priority }) {
  const Icon =
    priority === "urgent"
      ? AlertCircle
      : priority === "high"
        ? SignalHigh
        : priority === "medium"
          ? SignalMedium
          : priority === "low"
            ? SignalLow
            : CircleDashed;
  return (
    <Icon
      className={`priority-icon priority-${priority || "none"}`}
      size={15}
      aria-hidden="true"
    />
  );
}
export function ErrorNotice({ children }: { children: ReactNode }) {
  return (
    <div className="error-notice" role="alert">
      <AlertCircle size={16} />
      <span>{children}</span>
    </div>
  );
}
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-symbol">
        <Inbox size={25} strokeWidth={1.5} />
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  drawer = false,
  subtitle,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  drawer?: boolean;
  subtitle?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const labelId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={drawer ? "dialog drawer" : "dialog"}
      aria-labelledby={labelId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <div className="dialog-heading">
        <div>
          {subtitle && <p className="eyebrow">{subtitle}</p>}
          <h2 id={labelId}>{title}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
