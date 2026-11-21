import type { IssuePatch } from "./issueFile";
import { AGENT_READY } from "./gates";
import type { Issue, StatusDef } from "./types";

export type TriageAction = "accept" | "ready" | "decline";

const stamp = (v: string | undefined): string => (v ? v.replace(" ", "T") : "");

/** Tickets in a triage-category status, newest first. */
export function triageIssues(issues: readonly Issue[], statuses: readonly StatusDef[]): Issue[] {
  const names = new Set(statuses.filter((s) => s.category === "triage").map((s) => s.name));
  return issues
    .filter((i) => names.has(i.status))
    .sort((a, b) => stamp(b.created).localeCompare(stamp(a.created)) || b.id.localeCompare(a.id, undefined, { numeric: true }));
}

/** Sum of the "+N" in dedupe comments ("seen again (+1) from ..."). */
export function seenCount(issue: Pick<Issue, "feed">): number {
  let n = 0;
  for (const f of issue.feed) {
    if (f.type !== "comment") continue;
    const m = /^seen again \(\+(\d+)\)/.exec(f.body);
    if (m) n += Number(m[1]);
  }
  return n;
}

/** `5m`, `3h`, `2d` since `created` (local `YYYY-MM-DD HH:mm`); empty when unknown. */
export function ageLabel(created: string | undefined, now: Date): string {
  const t = created ? new Date(stamp(created)).getTime() : NaN;
  if (Number.isNaN(t)) return "";
  const min = Math.max(0, Math.floor((now.getTime() - t) / 60000));
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.floor(min / 60)}h`;
  return `${Math.floor(min / 1440)}d`;
}

/** First status of a category by order. */
export function firstOfCategory(statuses: readonly StatusDef[], category: StatusDef["category"]): string | undefined {
  return [...statuses].filter((s) => s.category === category).sort((a, b) => a.order - b.order)[0]?.name;
}

export interface TriagePlan {
  patch: IssuePatch;
  /** Activity event to log after the update. */
  event?: string;
  /** Comment to add after the update. */
  comment?: string;
}

/** What a triage key does. `defaultStatus` is the settings default (backlog); null when no target status exists. */
export function planTriage(
  issue: Pick<Issue, "tags">,
  action: TriageAction,
  statuses: readonly StatusDef[],
  defaultStatus: string,
  reason = "",
): TriagePlan | null {
  if (action === "decline") {
    const status = firstOfCategory(statuses, "canceled");
    return status ? { patch: { status }, comment: `Declined: ${reason.trim() || "no reason given"}` } : null;
  }
  const status = statuses.some((s) => s.name === defaultStatus) ? defaultStatus : firstOfCategory(statuses, "backlog");
  if (!status) return null;
  if (action === "accept") return { patch: { status }, event: "accepted" };
  const tags = issue.tags.includes(AGENT_READY) ? [...issue.tags] : [...issue.tags, AGENT_READY];
  return { patch: { status, tags }, event: "accepted (agent-ready)" };
}

/** Fields restored by undo. */
export interface UndoEntry {
  id: string;
  before: { status: string; tags: string[] };
  /** Body of the decline comment to remove. */
  comment?: string;
}

export const undoPatch = (e: UndoEntry): IssuePatch => ({ status: e.before.status, tags: [...e.before.tags] });
