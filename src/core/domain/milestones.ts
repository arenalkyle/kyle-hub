import { fromLink } from "./links";
import { issueInProject } from "./projects";
import type { Issue, Milestone, Project, StatusDef } from "./types";

export interface MilestoneProgress {
  name: string;
  done: number;
  /** Issues in the milestone excluding canceled ones. */
  total: number;
  /** 0..100, rounded. */
  percent: number;
}

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

export const issueInMilestone = (i: Issue, project: string, milestone: string): boolean =>
  issueInProject(i, project) && i.milestone !== undefined && sameName(fromLink(i.milestone), milestone);

/** Per milestone of `project` (in its order): done = completed-category issues; total excludes canceled ones. */
export function milestoneProgress(
  project: Pick<Project, "name" | "milestones">,
  issues: readonly Issue[],
  statuses: readonly Pick<StatusDef, "name" | "category">[],
): MilestoneProgress[] {
  const cat = new Map(statuses.map((s) => [s.name, s.category]));
  return project.milestones.map((m) => {
    let done = 0;
    let total = 0;
    for (const i of issues) {
      if (!issueInMilestone(i, project.name, m.name)) continue;
      const c = cat.get(i.status);
      if (c === "canceled") continue;
      total++;
      if (c === "completed") done++;
    }
    return { name: m.name, done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
  });
}

/** Past its target date (`today` is `YYYY-MM-DD`) and not complete. A milestone without issues is never complete. */
export function isMilestoneOverdue(m: Pick<Milestone, "target">, progress: Pick<MilestoneProgress, "done" | "total">, today: string): boolean {
  if (!m.target || m.target >= today) return false;
  return !(progress.total > 0 && progress.done === progress.total);
}

/** Error message, or null when `name` can be used. `current` is the milestone's own name when renaming. */
export function validateMilestoneName(name: string, existing: Iterable<string>, current?: string): string | null {
  const n = name.trim();
  if (n === "") return "Enter a milestone name.";
  if (n.length > 100) return "That name is too long (100 characters max).";
  for (const e of existing) {
    if (current !== undefined && sameName(e, current)) continue;
    if (sameName(e, n)) return `A milestone named "${e}" already exists.`;
  }
  return null;
}

/**
 * Milestone an issue keeps after its project changes: unchanged when the new project has a milestone
 * of that name, `undefined` (cleared) otherwise, including when there is no project.
 */
export function milestoneAfterProjectChange(
  milestone: string | undefined,
  newProject: Pick<Project, "milestones"> | null | undefined,
): string | undefined {
  if (milestone === undefined) return undefined;
  const name = fromLink(milestone);
  return newProject?.milestones.some((m) => sameName(m.name, name)) ? milestone : undefined;
}

/** Moves the item at `from` to index `to`. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length) return out;
  out.splice(to, 0, out.splice(from, 1)[0]!);
  return out;
}

/** Reorders `milestones` to follow `names`; milestones not listed keep their relative order at the end. */
export function reorderMilestones(milestones: readonly Milestone[], names: readonly string[]): Milestone[] {
  const rank = new Map(names.map((n, i) => [n.toLowerCase(), i]));
  const idx = (m: Milestone) => rank.get(m.name.toLowerCase()) ?? names.length;
  return milestones.map((m, i) => ({ m, i })).sort((a, b) => idx(a.m) - idx(b.m) || a.i - b.i).map((x) => x.m);
}
