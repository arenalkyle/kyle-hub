import { DEFAULT_STATUSES, PRIORITY_ORDER } from "./defaults";
import { fromLink } from "./links";
import type { Issue, Project, Settings, StatusDef } from "./types";

export type ViewId = "all" | "active" | "backlog" | `project:${string}`;

export type GroupBy = "none" | "status";

/** One List section / Board column. `subgroups` is reserved for sub-grouping (Phase 4.1). */
export interface Group {
  key: string;
  label: string;
  /** Present for status groups so the UI can draw the status icon. */
  status?: StatusDef;
  issues: Issue[];
  subgroups?: Group[];
}

export interface GroupOptions {
  /** Keep groups with no issues (default false). */
  showEmpty?: boolean;
}

export const OTHER_GROUP_KEY = "__other__";

export function projectViewId(name: string): ViewId {
  return `project:${name}`;
}

export function viewTitle(viewId: string): string {
  switch (viewId) {
    case "all":
      return "All Issues";
    case "active":
      return "Active";
    case "backlog":
      return "Backlog";
    default:
      return viewId.startsWith("project:") ? viewId.slice("project:".length) : viewId;
  }
}

/** Issues belonging to a sidebar view. Unknown status never matches Active/Backlog. */
export function selectView(
  issues: readonly Issue[],
  viewId: string,
  projects: readonly Project[],
  settings?: Pick<Settings, "statuses">,
): Issue[] {
  if (viewId.startsWith("project:")) {
    const raw = viewId.slice("project:".length);
    const name = (projects.find((p) => p.name.toLowerCase() === raw.toLowerCase())?.name ?? raw).toLowerCase();
    return issues.filter((i) => i.project !== undefined && fromLink(i.project).toLowerCase() === name);
  }
  if (viewId === "all") return [...issues];
  const cats = viewId === "active" ? ["unstarted", "started"] : viewId === "backlog" ? ["backlog"] : null;
  if (!cats) return [...issues];
  const statuses = settings?.statuses ?? DEFAULT_STATUSES;
  const catOf = new Map(statuses.map((s) => [s.name, s.category]));
  return issues.filter((i) => {
    const c = catOf.get(i.status);
    return c !== undefined && cats.includes(c);
  });
}

const priorityRank = (i: Issue): number => PRIORITY_ORDER.indexOf(i.priority);

/** Priority (urgent first, none last), then `updated` descending. */
export function compareDefault(a: Issue, b: Issue): number {
  const p = priorityRank(a) - priorityRank(b);
  if (p !== 0) return p;
  const ua = a.updated ?? "";
  const ub = b.updated ?? "";
  if (ua !== ub) return ua < ub ? 1 : -1;
  return a.id.localeCompare(b.id, undefined, { numeric: true });
}

export function sortIssues(issues: readonly Issue[]): Issue[] {
  return [...issues].sort(compareDefault);
}

export function groupIssues(
  issues: readonly Issue[],
  groupBy: GroupBy,
  settings: Pick<Settings, "statuses">,
  opts: GroupOptions = {},
): Group[] {
  const sorted = sortIssues(issues);
  if (groupBy === "none") {
    if (sorted.length === 0 && !opts.showEmpty) return [];
    return [{ key: "all", label: "All issues", issues: sorted }];
  }
  const defs = [...settings.statuses].sort((a, b) => a.order - b.order);
  const known = new Set(defs.map((s) => s.name));
  const groups: Group[] = defs.map((s) => ({
    key: s.name,
    label: s.name,
    status: s,
    issues: sorted.filter((i) => i.status === s.name),
  }));
  const other = sorted.filter((i) => !known.has(i.status));
  groups.push({ key: OTHER_GROUP_KEY, label: "Other", issues: other });
  return opts.showEmpty ? groups : groups.filter((g) => g.issues.length > 0);
}
