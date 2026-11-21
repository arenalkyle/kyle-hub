import { STATUS_CATEGORIES } from "./statuses";
import type { Issue, StatusDef } from "./types";

export type EventIcon = "create" | "status" | "priority" | "assignee" | "label" | "link" | "calendar" | "edit" | "other";

export interface HumanEvent {
  /** Phrase after the author, e.g. `changed status from Todo to Done`. */
  phrase: string;
  icon: EventIcon;
}

const SET = /^set ([a-z ]+): (.*?) → (.*)$/i;

const ICONS: Record<string, EventIcon> = {
  title: "edit", status: "status", priority: "priority", assignee: "assignee",
  project: "link", milestone: "link", parent: "link", due: "calendar",
};

/** Turns stored event text (`set status: Todo → Done`) into human phrasing; unknown text passes through. */
export function humanizeEvent(text: string): HumanEvent {
  const t = text.trim();
  if (t === "created the issue") return { phrase: t, icon: "create" };
  const m = SET.exec(t);
  if (m) {
    const [, field, from, to] = m as unknown as [string, string, string, string];
    const f = field.toLowerCase();
    const icon = ICONS[f] ?? "other";
    if (from === "none") return { phrase: `set ${f} to ${to}`, icon };
    if (to === "none") return { phrase: `removed ${f} ${from}`, icon };
    return { phrase: `changed ${f} from ${from} to ${to}`, icon };
  }
  const label = /^(added|removed) label: (.*)$/.exec(t);
  if (label) return { phrase: `${label[1]} label ${label[2]}`, icon: "label" };
  return { phrase: t, icon: "other" };
}

const PRIORITY_RANK = ["urgent", "high", "medium", "low", "none"];

/** Sub-issues ordered by status category (settings order), then priority, then id. */
export function orderSubIssues(children: readonly Issue[], statuses: readonly StatusDef[]): Issue[] {
  const cat = (i: Issue): number => {
    const c = statuses.find((s) => s.name === i.status)?.category ?? "backlog";
    return STATUS_CATEGORIES.indexOf(c);
  };
  return [...children].sort(
    (a, b) =>
      cat(a) - cat(b) ||
      PRIORITY_RANK.indexOf(a.priority) - PRIORITY_RANK.indexOf(b.priority) ||
      a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
}

/** Progress count: sub-issues in a completed-category status over all sub-issues. */
export function subIssueProgress(children: readonly Issue[], statuses: readonly StatusDef[]): { done: number; total: number } {
  const done = children.filter((i) => statuses.find((s) => s.name === i.status)?.category === "completed").length;
  return { done, total: children.length };
}
