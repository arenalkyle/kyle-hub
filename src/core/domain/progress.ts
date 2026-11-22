import { categoryOf } from "./fields";
import type { Issue, StatusDef } from "./types";

export interface ParentProgress {
  parent: Issue;
  done: number;
  total: number;
  /** Whole percent, 0-100. */
  percent: number;
  /** Title of the child being worked on now (else the next unstarted one); undefined when none is left. */
  current?: Issue;
}

/**
 * Progress of every open ticket that has children. Canceled children are ignored;
 * parents that are completed/canceled are skipped. Sorted by percent descending, then id.
 */
export function parentProgress(issues: readonly Issue[], statuses: readonly StatusDef[]): ParentProgress[] {
  const byParent = new Map<string, Issue[]>();
  for (const i of issues) if (i.parent) byParent.set(i.parent, [...(byParent.get(i.parent) ?? []), i]);
  const out: ParentProgress[] = [];
  for (const parent of issues) {
    const kids = (byParent.get(parent.id) ?? []).filter((k) => categoryOf(k.status, statuses) !== "canceled");
    if (kids.length === 0) continue;
    const pc = categoryOf(parent.status, statuses);
    if (pc === "completed" || pc === "canceled") continue;
    const done = kids.filter((k) => categoryOf(k.status, statuses) === "completed").length;
    const current =
      kids.find((k) => categoryOf(k.status, statuses) === "started") ??
      kids.find((k) => {
        const c = categoryOf(k.status, statuses);
        return c === "unstarted" || c === "backlog";
      });
    out.push({ parent, done, total: kids.length, percent: Math.round((done / kids.length) * 100), current });
  }
  return out.sort((a, b) => b.percent - a.percent || a.parent.id.localeCompare(b.parent.id));
}
