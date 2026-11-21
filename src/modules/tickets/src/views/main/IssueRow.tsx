import { memo, type MouseEvent, type ReactNode } from "react";
import type { PropKey } from "../../../../../core/domain/display";
import type { Issue, Settings } from "../../../../../core/domain/types";
import {
  AssigneeChip, CreatedChip, DueChip, LabelChip, MilestoneChip, ProjectChip, PullRequestChip, SubIssuesChip, TypeChip,
} from "../components/chips";
import { PriorityIcon, StatusIcon } from "../components/icons";

export interface IssueRowProps {
  issue: Issue;
  settings: Settings;
  properties: Record<PropKey, boolean>;
  /** Number of hidden sub-issues (only set when "Show sub-issues" is off). */
  subCount?: number;
  /** Indented under a sub-group header. */
  sub?: boolean;
  selected?: boolean;
  /** Extra chips shown before the standard ones (Triage: source, repo, age, +N seen). */
  extra?: ReactNode;
  onOpen: (issue: Issue, newTab: boolean) => void;
  onStatus: (issue: Issue, anchor: HTMLElement) => void;
  onPriority: (issue: Issue, anchor: HTMLElement) => void;
}

export const IssueRow = memo(function IssueRow({
  issue, settings, properties: p, subCount, sub, selected, extra, onOpen, onStatus, onPriority,
}: IssueRowProps) {
  const def = settings.statuses.find((s) => s.name === issue.status);
  const stop = (fn: (anchor: HTMLElement) => void) => (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    fn(e.currentTarget);
  };
  return (
    <div className={`kh-tickets-row${sub ? " is-sub" : ""}${selected ? " is-selected" : ""}`} data-kh-tickets-id={issue.id} onClick={(e) => onOpen(issue, e.ctrlKey || e.metaKey)}>
      {p.priority ? (
        <button type="button" className="kh-tickets-row-btn" title="Priority" onClick={stop((a) => onPriority(issue, a))}>
          <PriorityIcon priority={issue.priority} />
        </button>
      ) : (
        <span />
      )}
      {p.id ? <span className="kh-tickets-row-id">{issue.id}</span> : <span />}
      {p.status ? (
        <button type="button" className="kh-tickets-row-btn" title={issue.status} onClick={stop((a) => onStatus(issue, a))}>
          <StatusIcon category={def?.category ?? "backlog"} color={def?.color} />
        </button>
      ) : (
        <span />
      )}
      <span className="kh-tickets-row-title">{issue.title}</span>
      <span className="kh-tickets-row-chips">
        {extra}
        {p.type && <TypeChip type={issue.type} />}
        {subCount ? <SubIssuesChip count={subCount} /> : null}
        {p.labels && issue.tags.map((t) => <LabelChip key={t} label={t} color={settings.labelColors[t]} />)}
        {p.project && issue.project && <ProjectChip project={issue.project} />}
        {p.milestone && issue.milestone && <MilestoneChip milestone={issue.milestone} />}
        {p.pullRequests && issue.pullRequests.length > 0 && <PullRequestChip urls={issue.pullRequests} />}
        {p.due && issue.due && <DueChip due={issue.due} />}
        {p.assignee && issue.assignee && <AssigneeChip assignee={issue.assignee} />}
        {p.created && issue.created && <CreatedChip created={issue.created} />}
      </span>
    </div>
  );
});
