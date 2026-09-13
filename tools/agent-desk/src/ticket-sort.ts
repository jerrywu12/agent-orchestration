import { compareEffort } from "./effort";
import type { Agent, Ticket } from "./types";

export const ticketSortOptions = [
  ["effort-asc", "Effort: smallest first"],
  ["effort-desc", "Effort: largest first"],
  ["priority-asc", "Priority: highest first"],
  ["priority-desc", "Priority: lowest first"],
  ["owner-asc", "Owner: A–Z"],
  ["owner-desc", "Owner: Z–A"],
  ["stageChanged-asc", "Stage changed: oldest first"],
  ["stageChanged-desc", "Stage changed: newest first"],
  ["name-asc", "Name: A–Z"],
  ["name-desc", "Name: Z–A"],
] as const;

const priorityRank = { urgent: 0, high: 1, medium: 2, low: 3 };
const nameOrder = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

export function ticketComparator(sort: string, agents: Agent[]) {
  const [field, direction] = sort.split("-");
  const descending = direction === "desc";
  const ownerNames = new Map(
    agents.map((agent) => [agent.id, agent.name.trim() || null]),
  );
  const value = (ticket: Ticket): string | number | null => {
    switch (field) {
      case "priority":
        return ticket.priority === "none"
          ? null
          : (priorityRank[ticket.priority] ?? null);
      case "owner":
        return (ticket.ownerId && ownerNames.get(ticket.ownerId)) || null;
      case "stageChanged": {
        const at = ticket.stageChangedAt
          ? Date.parse(ticket.stageChangedAt)
          : NaN;
        return Number.isFinite(at) ? at : null;
      }
      case "name":
        return ticket.title?.trim() || null;
      default:
        return null;
    }
  };
  return (left: Ticket, right: Ticket) => {
    if (field === "effort")
      return compareEffort(left.effort, right.effort, descending);
    const a = value(left),
      b = value(right);
    if (a == null) return b == null ? 0 : 1;
    if (b == null) return -1;
    const compared =
      typeof a === "number" && typeof b === "number"
        ? a - b
        : nameOrder.compare(String(a), String(b));
    return compared * (descending ? -1 : 1);
  };
}
