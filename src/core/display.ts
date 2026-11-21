export type GroupBy = "none" | "status" | "priority" | "project" | "assignee" | "label" | "milestone";
export type OrderBy = "manual" | "priority" | "updated" | "created" | "due";
export type CompletedMode = "all" | "week" | "none";
export type Layout = "list" | "board";

export const PROP_KEYS = [
  "id", "status", "priority", "project", "due", "milestone", "labels", "created", "pullRequests", "assignee",
] as const;
export type PropKey = (typeof PROP_KEYS)[number];

export const PROP_LABELS: Record<PropKey, string> = {
  id: "ID", status: "Status", priority: "Priority", project: "Project", due: "Due date", milestone: "Milestone",
  labels: "Labels", created: "Created", pullRequests: "Pull requests", assignee: "Assignee",
};

export const GROUP_BY_LABELS: Record<GroupBy, string> = {
  none: "No grouping", status: "Status", priority: "Priority", project: "Project", assignee: "Assignee",
  label: "Label", milestone: "Milestone",
};
export const GROUP_BY_OPTIONS = Object.keys(GROUP_BY_LABELS) as GroupBy[];

export const ORDER_BY_LABELS: Record<OrderBy, string> = {
  manual: "Manual", priority: "Priority", updated: "Updated", created: "Created", due: "Due date",
};
export const ORDER_BY_OPTIONS = Object.keys(ORDER_BY_LABELS) as OrderBy[];

export const COMPLETED_LABELS: Record<CompletedMode, string> = { all: "All", week: "Past week", none: "None" };

export interface DisplayState {
  layout: Layout;
  groupBy: GroupBy;
  subGroupBy: GroupBy;
  orderBy: OrderBy;
  showSubIssues: boolean;
  completed: CompletedMode;
  showEmptyGroups: boolean;
  properties: Record<PropKey, boolean>;
}

export function defaultDisplay(): DisplayState {
  return {
    layout: "list",
    groupBy: "status",
    subGroupBy: "none",
    orderBy: "priority",
    showSubIssues: true,
    completed: "all",
    showEmptyGroups: false,
    properties: {
      id: true, status: true, priority: true, project: true, due: true, milestone: false,
      labels: true, created: true, pullRequests: true, assignee: true,
    },
  };
}

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

/** Merge persisted (untrusted) display state over defaults; invalid values fall back. */
export function mergeDisplay(raw: unknown): DisplayState {
  const d = defaultDisplay();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return d;
  const r = raw as Record<string, unknown>;
  const props = typeof r.properties === "object" && r.properties !== null ? (r.properties as Record<string, unknown>) : {};
  const properties = { ...d.properties };
  for (const k of PROP_KEYS) if (typeof props[k] === "boolean") properties[k] = props[k] as boolean;
  const groupBy = pick(r.groupBy, GROUP_BY_OPTIONS, d.groupBy);
  let subGroupBy = pick(r.subGroupBy, GROUP_BY_OPTIONS, d.subGroupBy);
  if (subGroupBy === groupBy) subGroupBy = "none";
  return {
    layout: pick(r.layout, ["list", "board"] as const, d.layout),
    groupBy,
    subGroupBy,
    orderBy: pick(r.orderBy, ORDER_BY_OPTIONS, d.orderBy),
    showSubIssues: typeof r.showSubIssues === "boolean" ? r.showSubIssues : d.showSubIssues,
    completed: pick(r.completed, ["all", "week", "none"] as const, d.completed),
    showEmptyGroups: typeof r.showEmptyGroups === "boolean" ? r.showEmptyGroups : d.showEmptyGroups,
    properties,
  };
}
