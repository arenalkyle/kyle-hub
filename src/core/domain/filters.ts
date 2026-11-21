import { DEFAULT_STATUSES } from "./defaults";
import { fromLink } from "./links";
import { formatDate } from "./time";
import type { Issue, Settings } from "./types";

export const FILTER_FIELDS = ["status", "priority", "project", "label", "assignee", "milestone", "due"] as const;
export type FilterField = (typeof FILTER_FIELDS)[number];
export type FilterOp = "in" | "notIn";

export const DUE_VALUES = ["overdue", "today", "week", "month", "none"] as const;
export type DueValue = (typeof DUE_VALUES)[number];

/** Filter value meaning "No project / label / assignee / milestone" (priority uses its own `none`). */
export const NONE_VALUE = "__none__";

export interface Filter {
  field: FilterField;
  op: FilterOp;
  values: string[];
}

export const FILTER_FIELD_LABELS: Record<FilterField, string> = {
  status: "Status", priority: "Priority", project: "Project", label: "Label", assignee: "Assignee",
  milestone: "Milestone", due: "Due date",
};

export const DUE_LABELS: Record<DueValue, string> = {
  overdue: "Overdue", today: "Due today", week: "Due this week", month: "Due this month", none: "No due date",
};

export const OP_LABELS: Record<FilterOp, string> = { in: "is any of", notIn: "is not any of" };

const PRIORITIES = ["urgent", "high", "medium", "low", "none"];

function dueMatches(due: string | undefined, v: string, today: string, now: Date, closed: boolean): boolean {
  if (v === "none") return !due;
  if (!due) return false;
  const d = due.slice(0, 10);
  switch (v) {
    case "overdue":
      return d < today && !closed;
    case "today":
      return d === today;
    case "week": {
      const mondayOffset = (now.getDay() + 6) % 7;
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
      return d >= formatDate(start) && d <= formatDate(end);
    }
    case "month":
      return d.slice(0, 7) === today.slice(0, 7);
    default:
      return false;
  }
}

const lc = (s: string): string => s.toLowerCase();

/** True when the issue has any of the filter's values (the `in` semantics). */
function hasAny(issue: Issue, f: Filter, now: Date, closed: boolean): boolean {
  const vals = f.values;
  const none = vals.includes(NONE_VALUE);
  const names = new Set(vals.filter((v) => v !== NONE_VALUE).map(lc));
  switch (f.field) {
    case "status":
      return vals.includes(issue.status);
    case "priority":
      return vals.includes(issue.priority);
    case "project": {
      const p = issue.project ? fromLink(issue.project) : "";
      return p ? names.has(lc(p)) : none;
    }
    case "milestone": {
      const m = issue.milestone ? fromLink(issue.milestone) : "";
      return m ? names.has(lc(m)) : none;
    }
    case "assignee": {
      const a = issue.assignee?.trim() ?? "";
      return a ? names.has(lc(a)) : none;
    }
    case "label":
      return issue.tags.length ? issue.tags.some((t) => names.has(lc(t))) : none;
    case "due": {
      const today = formatDate(now);
      return vals.some((v) => dueMatches(issue.due, v, today, now, closed));
    }
  }
}

/** AND of all conditions. Empty-valued conditions are ignored. `notIn` is the negation of `in`. */
export function applyFilters(
  issues: readonly Issue[],
  filters: readonly Filter[],
  now: Date,
  settings?: Pick<Settings, "statuses">,
): Issue[] {
  const active = filters.filter((f) => f.values.length > 0);
  if (active.length === 0) return [...issues];
  const catOf = new Map((settings?.statuses ?? DEFAULT_STATUSES).map((s) => [s.name, s.category]));
  return issues.filter((i) => {
    const c = catOf.get(i.status);
    const closed = c === "completed" || c === "canceled";
    return active.every((f) => hasAny(i, f, now, closed) === (f.op === "in"));
  });
}

/** Validate persisted (untrusted) filters. */
export function mergeFilters(raw: unknown): Filter[] {
  if (!Array.isArray(raw)) return [];
  const out: Filter[] = [];
  for (const r of raw) {
    if (typeof r !== "object" || r === null) continue;
    const { field, op, values } = r as Record<string, unknown>;
    if (!(FILTER_FIELDS as readonly string[]).includes(field as string)) continue;
    if (op !== "in" && op !== "notIn") continue;
    if (!Array.isArray(values)) continue;
    let vals = values.filter((v): v is string => typeof v === "string");
    if (field === "due") vals = vals.filter((v) => (DUE_VALUES as readonly string[]).includes(v));
    if (field === "priority") vals = vals.filter((v) => PRIORITIES.includes(v));
    if (vals.length === 0) continue;
    out.push({ field: field as FilterField, op, values: vals });
  }
  return out;
}

/** Replace (or add) the single condition for `field`; empty `values` removes it. Keeps the existing operator. */
export function setFilterValues(filters: readonly Filter[], field: FilterField, values: string[]): Filter[] {
  const existing = filters.find((f) => f.field === field);
  if (values.length === 0) return filters.filter((f) => f.field !== field);
  if (!existing) return [...filters, { field, op: "in", values }];
  return filters.map((f) => (f.field === field ? { ...f, values } : f));
}
