import { DEFAULT_STATUSES, PRIORITY_LABELS, PRIORITY_ORDER } from "./defaults";
import type { CompletedMode, DisplayState, GroupBy, OrderBy } from "./display";
import { applyFilters, type Filter } from "./filters";
import { fromLink } from "./links";
import type { Issue, Project, Settings, StatusDef } from "./types";

export type { GroupBy, OrderBy, CompletedMode };

export type ViewId = "all" | "active" | "backlog" | `project:${string}`;

/** One List section / Board column. */
export interface Group {
  key: string;
  label: string;
  /** Present for status groups so the UI can draw the status icon. */
  status?: StatusDef;
  issues: Issue[];
  /** Field this group represents and its value (absent for the No-value group); used to preset New issue. */
  field?: GroupBy;
  value?: string;
  subgroups?: Group[];
}

export interface GroupOptions {
  /** Keep groups with no issues (default false). */
  showEmpty?: boolean;
  /** Order inside each group (default priority). */
  orderBy?: OrderBy;
  /** Known projects, so empty project/milestone groups can be listed. */
  projects?: readonly Project[];
  /** Known label names for empty label groups. */
  labels?: readonly string[];
  /** Milestone grouping order (a project's milestones); unlisted milestones follow by name. */
  milestoneOrder?: readonly string[];
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

const cmpId = (a: Issue, b: Issue): number => a.id.localeCompare(b.id, undefined, { numeric: true });

/** Normalises `YYYY-MM-DD HH:mm` / `YYYY-MM-DDTHH:mm:ss` so string comparison orders chronologically. */
const stamp = (v: string | undefined): string | undefined => (v ? v.replace(" ", "T") : undefined);

/** Compare by an optional string key; missing keys always last; ties by id. */
const byKey =
  (key: (i: Issue) => string | undefined, dir: 1 | -1) =>
  (a: Issue, b: Issue): number => {
    const x = key(a);
    const y = key(b);
    if (x === y || (!x && !y)) return cmpId(a, b);
    if (!x) return 1;
    if (!y) return -1;
    return x < y ? -dir : dir;
  };

/** Returns a new array ordered by `orderBy`; ties fall back to the issue id, so results are deterministic. */
export function orderIssues(issues: readonly Issue[], orderBy: OrderBy): Issue[] {
  const out = [...issues];
  switch (orderBy) {
    case "manual":
      return out.sort((a, b) => {
        const x = a.sortOrder;
        const y = b.sortOrder;
        if (x === y || (x === undefined && y === undefined)) return cmpId(a, b);
        if (x === undefined) return 1;
        if (y === undefined) return -1;
        return x - y;
      });
    case "updated":
      return out.sort(byKey((i) => stamp(i.updated), -1));
    case "created":
      return out.sort(byKey((i) => stamp(i.created), -1));
    case "due":
      return out.sort(byKey((i) => i.due, 1));
    default:
      return out.sort(compareDefault);
  }
}

const byName = (a: string, b: string): number => a.localeCompare(b, undefined, { sensitivity: "base" });

/** Values an issue belongs to for `groupBy` (label may give several). `undefined` = the "No ..." group. */
function valuesOf(issue: Issue, groupBy: GroupBy): (string | undefined)[] {
  switch (groupBy) {
    case "project":
      return [issue.project ? fromLink(issue.project) : undefined];
    case "assignee":
      return [issue.assignee?.trim() || undefined];
    case "milestone":
      return [issue.milestone ? fromLink(issue.milestone) : undefined];
    case "label":
      return issue.tags.length ? [...new Set(issue.tags)] : [undefined];
    default:
      return [undefined];
  }
}

const NO_LABEL: Partial<Record<GroupBy, string>> = {
  project: "No project",
  assignee: "No assignee",
  label: "No label",
  milestone: "No milestone",
};

export function groupIssues(
  issues: readonly Issue[],
  groupBy: GroupBy,
  settings: Pick<Settings, "statuses">,
  opts: GroupOptions = {},
): Group[] {
  const sorted = orderIssues(issues, opts.orderBy ?? "priority");
  if (groupBy === "none") {
    if (sorted.length === 0 && !opts.showEmpty) return [];
    return [{ key: "none", label: "All issues", issues: sorted }];
  }
  let groups: Group[];
  if (groupBy === "status") {
    const defs = [...settings.statuses].sort((a, b) => a.order - b.order);
    const known = new Set(defs.map((s) => s.name));
    groups = defs.map((s) => ({
      key: `status:${s.name}`,
      label: s.name,
      status: s,
      field: "status" as const,
      value: s.name,
      issues: sorted.filter((i) => i.status === s.name),
    }));
    groups.push({ key: OTHER_GROUP_KEY, label: "Other", issues: sorted.filter((i) => !known.has(i.status)) });
  } else if (groupBy === "priority") {
    groups = PRIORITY_ORDER.map((p) => ({
      key: `priority:${p}`,
      label: PRIORITY_LABELS[p],
      field: "priority" as const,
      value: p === "none" ? undefined : p,
      issues: sorted.filter((i) => i.priority === p),
    }));
  } else {
    const buckets = new Map<string, Issue[]>();
    const empty: Issue[] = [];
    for (const i of sorted) {
      for (const v of valuesOf(i, groupBy)) {
        if (v === undefined) empty.push(i);
        else {
          const b = buckets.get(v);
          if (b) b.push(i);
          else buckets.set(v, [i]);
        }
      }
    }
    if (opts.showEmpty) {
      const extra =
        groupBy === "project"
          ? (opts.projects ?? []).map((p) => p.name)
          : groupBy === "milestone"
            ? opts.milestoneOrder
              ? [...opts.milestoneOrder]
              : (opts.projects ?? []).flatMap((p) => p.milestones.map((m) => m.name))
            : groupBy === "label"
              ? [...(opts.labels ?? [])]
              : [];
      for (const n of extra) if (!buckets.has(n)) buckets.set(n, []);
    }
    const order = groupBy === "milestone" ? opts.milestoneOrder : undefined;
    const rank = (n: string) => order?.findIndex((o) => o.toLowerCase() === n.toLowerCase()) ?? -1;
    const keys = [...buckets.keys()].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra < 0 && rb < 0) return byName(a, b);
      return ra < 0 ? 1 : rb < 0 ? -1 : ra - rb;
    });
    groups = keys.map((n) => ({
      key: `${groupBy}:${n}`,
      label: n,
      field: groupBy,
      value: n,
      issues: buckets.get(n)!,
    }));
    groups.push({ key: `none:${groupBy}`, label: NO_LABEL[groupBy] ?? "None", field: groupBy, issues: empty });
  }
  return opts.showEmpty ? groups : groups.filter((g) => g.issues.length > 0);
}

/** Adds `subgroups` to every group (counts stay on the parent group). No-op for `none`. */
export function subGroup(
  groups: readonly Group[],
  subBy: GroupBy,
  settings: Pick<Settings, "statuses">,
  opts: GroupOptions = {},
): Group[] {
  if (subBy === "none") return [...groups];
  return groups.map((g) => ({
    ...g,
    subgroups: groupIssues(g.issues, subBy, settings, { ...opts, showEmpty: false }).map((s) => ({
      ...s,
      key: `${g.key}/${s.key}`,
    })),
  }));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `week` keeps completed/canceled issues updated within the last 7 days (inclusive); `none` drops them. */
export function filterCompleted(
  issues: readonly Issue[],
  mode: CompletedMode,
  now: Date,
  settings?: Pick<Settings, "statuses">,
): Issue[] {
  if (mode === "all") return [...issues];
  const catOf = new Map((settings?.statuses ?? DEFAULT_STATUSES).map((s) => [s.name, s.category]));
  const cutoff = now.getTime() - 7 * DAY_MS;
  return issues.filter((i) => {
    const c = catOf.get(i.status);
    if (c !== "completed" && c !== "canceled") return true;
    if (mode === "none") return false;
    const t = i.updated ? new Date(stamp(i.updated)!).getTime() : NaN;
    return !Number.isNaN(t) && t >= cutoff;
  });
}

/** Removes issues that have a parent. */
export function hideSubIssues(issues: readonly Issue[]): Issue[] {
  return issues.filter((i) => !i.parent);
}

/** Parent id -> number of issues naming it as parent. */
export function subIssueCounts(issues: readonly Issue[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of issues) {
    if (!i.parent) continue;
    const p = fromLink(i.parent);
    m.set(p, (m.get(p) ?? 0) + 1);
  }
  return m;
}

export type IssueFilter = (issue: Issue) => boolean;

export interface BuiltView {
  groups: Group[];
  /** Issues remaining after the pipeline (header count). */
  total: number;
  /** Parent id -> sub-issue count; only populated when sub-issues are hidden. */
  subCounts: Map<string, number>;
}

/** selectView -> filterCompleted -> filters -> hideSubIssues -> group -> subGroup (ordered within leaves). */
export function buildView(
  issues: readonly Issue[],
  viewId: string,
  projects: readonly Project[],
  settings: Settings,
  display: DisplayState,
  filters: IssueFilter | readonly Filter[] | undefined,
  now: Date,
): BuiltView {
  let list = selectView(issues, viewId, projects, settings);
  const scopedName = viewId.startsWith("project:") ? viewId.slice("project:".length) : undefined;
  const scopedProject = scopedName === undefined ? undefined : projects.find((p) => p.name.toLowerCase() === scopedName.toLowerCase());
  list = filterCompleted(list, display.completed, now, settings);
  if (typeof filters === "function") list = list.filter(filters);
  else if (filters) list = applyFilters(list, filters, now, settings);
  const subCounts = display.showSubIssues ? new Map<string, number>() : subIssueCounts(list);
  if (!display.showSubIssues) list = hideSubIssues(list);
  const opts: GroupOptions = {
    showEmpty: display.showEmptyGroups,
    orderBy: display.orderBy,
    projects,
    labels: Object.keys(settings.labelColors),
    milestoneOrder: scopedProject?.milestones.map((m) => m.name),
  };
  const sub = display.subGroupBy === display.groupBy ? "none" : display.subGroupBy;
  const groups = subGroup(groupIssues(list, display.groupBy, settings, opts), sub, settings, opts);
  return { groups, total: list.length, subCounts };
}
