import { findProjectByLink } from "../../core/projects";
import { fromLink } from "../../core/links";
import { bestState, prLabel, prLabelOfUrl, type PrState } from "../../core/pr";
import { formatDate } from "../../core/time";
import { useProjects, usePrs } from "../../store/hooks";
import { Avatar } from "./Avatar";
import { Dot, Icon, ProjectGlyph } from "./icons";

export function LabelChip({ label, color }: { label: string; color?: string }) {
  return (
    <span className="kt-chip kt-chip-label" title={label}>
      <Dot color={color ?? "var(--text-faint)"} />
      <span className="kt-chip-text">{label}</span>
    </span>
  );
}

export function ProjectChip({ project }: { project: string }) {
  const name = fromLink(project);
  const def = findProjectByLink(useProjects(), project);
  return (
    <span className="kt-chip" title={name}>
      <ProjectGlyph icon={def?.icon} color={def?.color} size={12} />
      <span className="kt-chip-text">{name}</span>
    </span>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `YYYY-MM-DD...` -> `Mar 5`; falls back to the raw string. */
export function shortDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}`;
}

export function isOverdue(due: string, now: Date = new Date()): boolean {
  return due.slice(0, 10) < formatDate(now);
}

export function DueChip({ due }: { due: string }) {
  return (
    <span className={`kt-chip${isOverdue(due) ? " is-overdue" : ""}`} title={`Due ${due}`}>
      <Icon name="calendar" size={12} />
      <span className="kt-chip-text">{shortDate(due)}</span>
    </span>
  );
}

export function AssigneeChip({ assignee }: { assignee: string }) {
  return (
    <span className="kt-chip" title={assignee}>
      <Avatar name={assignee} />
      <span className="kt-chip-text">{assignee}</span>
    </span>
  );
}

export function CreatedChip({ created }: { created: string }) {
  return (
    <span className="kt-chip kt-chip-muted" title={`Created ${created}`}>
      <span className="kt-chip-text">{shortDate(created)}</span>
    </span>
  );
}

export function MilestoneChip({ milestone }: { milestone: string }) {
  return (
    <span className="kt-chip" title={`Milestone ${milestone}`}>
      <Icon name="flag" size={12} />
      <span className="kt-chip-text">{milestone}</span>
    </span>
  );
}

const PR_ICON: Record<PrState, string> = {
  open: "git-pull-request", draft: "git-pull-request-draft", merged: "git-merge", closed: "git-pull-request-closed",
};

export function PrStateIcon({ state, size = 12 }: { state?: PrState; size?: number }) {
  return (
    <span className={`kt-pr-icon${state ? ` kt-pr-${state}` : ""}`}>
      <Icon name={state ? PR_ICON[state] : "git-pull-request"} size={size} />
    </span>
  );
}

/** PR chip for rows/cards: icon colored by the best known state, plus a count when more than one. */
export function PullRequestChip({ urls }: { urls: readonly string[] }) {
  const prs = usePrs(urls);
  const best = bestState(prs.flatMap((p) => (p.info ? [p.info] : [])));
  const count = urls.length;
  return (
    <span className="kt-chip" title={prs.map((p) => (p.info ? `${prLabel(p.info)} · ${p.info.title} (${p.info.state})` : prLabelOfUrl(p.url))).join("\n")}>
      <PrStateIcon state={best} />
      {count > 1 && <span className="kt-chip-text">{count}</span>}
    </span>
  );
}

export function SubIssuesChip({ count }: { count: number }) {
  return (
    <span className="kt-chip" title={`${count} sub-issue${count === 1 ? "" : "s"}`}>
      <Icon name="list-tree" size={12} />
      <span className="kt-chip-text">{count} sub-issues</span>
    </span>
  );
}
