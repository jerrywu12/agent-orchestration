import { Activity as ActivityIcon, MessageSquare } from "lucide-react";
import type { Activity, DeskState } from "../types";
import { AgentAvatar, EmptyState, ticketKey, timeAgo } from "./shared";

export function ActivityFeed({
  items,
  state,
  onTicket,
  compact = false,
}: {
  items: Activity[];
  state: DeskState;
  onTicket?: (id: string) => void;
  compact?: boolean;
}) {
  if (!items.length)
    return compact ? (
      <p className="muted small activity-empty">
        No activity yet. Updates and comments appear here.
      </p>
    ) : (
      <EmptyState title="The story starts here">
        Ticket changes, agent updates, and sync activity will appear as work
        happens.
      </EmptyState>
    );
  return (
    <ol className={`activity-feed ${compact ? "compact" : ""}`}>
      {items.map((item) => {
        const agent = state.agents.find((value) => value.id === item.agentId);
        const ticket = state.tickets.find(
          (value) => value.id === item.ticketId,
        );
        return (
          <li key={item.id}>
            <span className="activity-mark">
              {agent ? (
                <AgentAvatar agent={agent} small />
              ) : item.kind === "comment" ? (
                <MessageSquare size={14} />
              ) : (
                <ActivityIcon size={14} />
              )}
            </span>
            <div className="activity-content">
              <div className="activity-meta">
                <strong>
                  {agent?.name ||
                    (item.kind === "comment" ? "Comment" : "Workspace")}
                </strong>
                <span>{item.kind.replaceAll("_", " ")}</span>
                <time dateTime={item.at} title={item.at}>
                  {timeAgo(item.at)}
                </time>
              </div>
              <p>{item.summary}</p>
              {ticket && onTicket && (
                <button
                  className="text-button activity-ticket"
                  onClick={() => onTicket(ticket.id)}
                >
                  {ticketKey(ticket, state.projects)} · {ticket.title}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
