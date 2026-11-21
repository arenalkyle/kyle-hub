import { fromLink } from "../../core/links";
import { formatDate } from "../../core/time";
import { Dot, Icon } from "./icons";

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
  return (
    <span className="kt-chip" title={name}>
      <Icon name="box" size={12} />
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
      <span className="kt-avatar">{assignee.charAt(0).toUpperCase()}</span>
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
