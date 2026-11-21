import { fromLink, toLink } from "./links";
import type { Issue, Project, ProjectStatus, StatusDef } from "./types";

export const PROJECT_STATUSES: readonly ProjectStatus[] = ["backlog", "planned", "started", "paused", "completed", "canceled"];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  backlog: "Backlog",
  planned: "Planned",
  started: "In Progress",
  paused: "Paused",
  completed: "Completed",
  canceled: "Canceled",
};

/** Sidebar/list order: active work first, finished last. */
const SORT_ORDER: readonly ProjectStatus[] = ["started", "planned", "backlog", "paused", "completed", "canceled"];

export const isArchivedStatus = (s: ProjectStatus): boolean => s === "completed" || s === "canceled";

export const INVALID_NAME_CHARS = /[\/:*?"<>|]/;

/** Returns an error message, or null when `name` can be used. `current` is the project's own name when renaming. */
export function validateProjectName(name: string, existing: Iterable<string>, current?: string): string | null {
  const n = name.trim();
  if (n === "") return "Enter a project name.";
  if (INVALID_NAME_CHARS.test(n)) return 'A project name cannot contain / \ : * ? " < > |';
  if (n === "." || n === ".." || n.startsWith(".")) return "A project name cannot start with a dot.";
  if (n.length > 100) return "That name is too long (100 characters max).";
  const lower = n.toLowerCase();
  for (const e of existing) {
    if (current !== undefined && e.toLowerCase() === current.toLowerCase()) continue;
    if (e.toLowerCase() === lower) return `A project named "${e}" already exists.`;
  }
  return null;
}

export interface ProjectProgress {
  done: number;
  /** Issues in the project excluding canceled ones. */
  total: number;
  /** 0..1 */
  ratio: number;
}

export const issueInProject = (i: Issue, name: string): boolean =>
  i.project !== undefined && fromLink(i.project).toLowerCase() === name.toLowerCase();

/** done = completed-category issues; total excludes canceled ones. */
export function projectProgress(issues: readonly Issue[], name: string, statuses: readonly Pick<StatusDef, "name" | "category">[]): ProjectProgress {
  const cat = new Map(statuses.map((s) => [s.name, s.category]));
  let done = 0;
  let total = 0;
  for (const i of issues) {
    if (!issueInProject(i, name)) continue;
    const c = cat.get(i.status);
    if (c === "canceled") continue;
    total++;
    if (c === "completed") done++;
  }
  return { done, total, ratio: total === 0 ? 0 : done / total };
}

/** Pure rename helper: `[[Old]]`/`Old` (and `[[Old|alias]]`) become `[[New]]` (`[[New|alias]]`); other values are unchanged. */
export function rewriteProjectLink(value: string, oldName: string, newName: string): string {
  if (fromLink(value).toLowerCase() !== oldName.toLowerCase()) return value;
  const alias = /\|([^\]]*)\]\]\s*$/.exec(value);
  return alias ? `[[${newName}|${alias[1]}]]` : toLink(newName);
}

/** Orders by status (active first) then name. */
export function sortProjects(projects: readonly Project[]): Project[] {
  return [...projects].sort(
    (a, b) => SORT_ORDER.indexOf(a.status) - SORT_ORDER.indexOf(b.status) || a.name.localeCompare(b.name),
  );
}

export function splitArchived(projects: readonly Project[]): { active: Project[]; archived: Project[] } {
  const sorted = sortProjects(projects);
  return { active: sorted.filter((p) => !isArchivedStatus(p.status)), archived: sorted.filter((p) => isArchivedStatus(p.status)) };
}
