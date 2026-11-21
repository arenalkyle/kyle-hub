import type { StatusCategory, StatusDef } from "./types";

export const STATUS_CATEGORIES: readonly StatusCategory[] = [
  "triage", "backlog", "unstarted", "started", "completed", "canceled",
];

export const CATEGORY_LABELS: Record<StatusCategory, string> = {
  triage: "Triage",
  backlog: "Backlog",
  unstarted: "Unstarted",
  started: "Started",
  completed: "Completed",
  canceled: "Canceled",
};

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Returns an error message, or null when the list is valid: names non-empty and unique
 * (case-insensitive), exactly one default (which must exist), and every category in
 * `usedCategories` (categories of existing issues' statuses) still has a status.
 */
export function validateStatuses(
  statuses: readonly StatusDef[],
  defaultStatus: string,
  usedCategories: Iterable<StatusCategory> = [],
): string | null {
  if (statuses.length === 0) return "At least one status is required.";
  const seen = new Set<string>();
  for (const s of statuses) {
    const n = s.name.trim();
    if (n === "") return "Status names cannot be empty.";
    if (seen.has(n.toLowerCase())) return `Duplicate status name "${n}".`;
    seen.add(n.toLowerCase());
  }
  const defaults = statuses.filter((s) => s.name === defaultStatus);
  if (defaults.length !== 1) return "Exactly one status must be the default for new issues.";
  for (const c of usedCategories) {
    if (!statuses.some((s) => s.category === c)) return `No status left in the ${CATEGORY_LABELS[c]} category, which existing issues use.`;
  }
  return null;
}

/**
 * Checks deleting `name`: the default cannot be deleted; a replacement is required when
 * issues use it (and must be another existing status); the result must stay valid.
 */
export function validateDelete(
  statuses: readonly StatusDef[],
  defaultStatus: string,
  name: string,
  reassignTo: string | undefined,
  issueCount: number,
  usedCategories: Iterable<StatusCategory> = [],
): string | null {
  if (!statuses.some((s) => s.name === name)) return `Unknown status "${name}".`;
  if (name === defaultStatus) return "Make another status the default before deleting this one.";
  const rest = statuses.filter((s) => s.name !== name);
  if (reassignTo === undefined || reassignTo === "") {
    if (issueCount > 0) return `Choose a status to move ${issueCount} issue${issueCount === 1 ? "" : "s"} to.`;
  } else if (reassignTo === name || !rest.some((s) => s.name === reassignTo)) {
    return "Choose a different, existing status to move issues to.";
  }
  return validateStatuses(rest, defaultStatus, usedCategories);
}

/** Renumbers `order` to match array position. */
export function normalizeOrder(statuses: readonly StatusDef[]): StatusDef[] {
  return statuses.map((s, i) => ({ ...s, order: i }));
}

/** Statuses sorted by `order`. */
export function sortedStatuses(statuses: readonly StatusDef[]): StatusDef[] {
  return [...statuses].sort((a, b) => a.order - b.order);
}

/** A name like "New status", "New status 2", ... not used by `statuses`. */
export function uniqueStatusName(statuses: readonly StatusDef[], base = "New status"): string {
  let n = 1;
  let name = base;
  while (statuses.some((s) => sameName(s.name, name))) name = `${base} ${++n}`;
  return name;
}

/** Applies a rename to the list (name only); returns an error when invalid. */
export function renameStatusIn(
  statuses: readonly StatusDef[],
  from: string,
  to: string,
): { statuses: StatusDef[] } | { error: string } {
  const name = to.trim();
  if (name === "") return { error: "Status names cannot be empty." };
  if (statuses.some((s) => s.name !== from && sameName(s.name, name))) return { error: `Duplicate status name "${name}".` };
  const next = statuses.map((s) => (s.name === from ? { ...s, name } : s));
  return { statuses: next };
}
