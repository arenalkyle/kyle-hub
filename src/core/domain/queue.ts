import type { Issue, StatusDef } from "./types";
import { categoryOf } from "./fields";
import { AGENT_READY } from "./gates";

/** Queue = agent-ready ∧ unstarted ∧ every blocker completed (a missing blocker counts as open). */
export function isQueued(ticket: Issue, all: readonly Issue[], statuses: readonly StatusDef[]): boolean {
  if (!ticket.tags.some((t) => t.trim().toLowerCase() === AGENT_READY)) return false;
  if (categoryOf(ticket.status, statuses) !== "unstarted") return false;
  return (ticket.blockedBy ?? []).every((id) => {
    const blocker = all.find((i) => i.id === id);
    return blocker !== undefined && categoryOf(blocker.status, statuses) === "completed";
  });
}

const PRIORITY_RANK: Record<Issue["priority"], number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

/** Queue order: priority, then `sortOrder` (unset last), then id. */
export function queueOrder(tickets: readonly Issue[]): Issue[] {
  return [...tickets].sort(
    (a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity) ||
      a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
}
