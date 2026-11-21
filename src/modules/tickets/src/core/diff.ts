import { PRIORITY_LABELS } from "./defaults";
import { fromLink } from "./links";
import { formatFeedTime } from "./time";
import type { ActivityEvent, Issue } from "./types";

const none = (v: string | undefined): string => (v === undefined || v === "" ? "none" : v);
const link = (v: string | undefined): string | undefined => (v === undefined ? v : fromLink(v));

/**
 * Field-level activity events between two versions of an issue, in a fixed order:
 * title, status, priority, assignee, project, milestone, parent, due, labels.
 * Pure: `now` is passed in. Returns `[]` when nothing tracked changed (description,
 * activity feed, `updated`, `sortOrder`, PRs and unknown keys are never logged).
 */
export function diffToEvents(before: Issue, after: Issue, author: string, now: Date): ActivityEvent[] {
  const who = author.replace(/^@/, "");
  const time = formatFeedTime(now);
  const out: ActivityEvent[] = [];
  const push = (text: string): void => {
    out.push({ type: "event", author: who, time, text });
  };
  const set = (label: string, a: string | undefined, b: string | undefined): void => {
    if (none(a) !== none(b)) push(`set ${label}: ${none(a)} → ${none(b)}`);
  };

  set("title", before.title, after.title);
  set("status", before.status, after.status);
  if (before.priority !== after.priority) {
    push(`set priority: ${PRIORITY_LABELS[before.priority]} → ${PRIORITY_LABELS[after.priority]}`);
  }
  set("assignee", before.assignee, after.assignee);
  set("project", link(before.project), link(after.project));
  set("milestone", before.milestone, after.milestone);
  set("parent", link(before.parent), link(after.parent));
  set("due", before.due, after.due);
  for (const t of after.tags) if (!before.tags.includes(t)) push(`added label: ${t}`);
  for (const t of before.tags) if (!after.tags.includes(t)) push(`removed label: ${t}`);
  for (const t of after.related) if (!before.related.includes(t)) push(`added related ${t}`);
  for (const t of before.related) if (!after.related.includes(t)) push(`removed related ${t}`);
  return out;
}
