import { memo } from "react";
import type { PropKey } from "../../../../../core/domain/display";
import type { Issue, Settings } from "../../../../../core/domain/types";
import { DueChip, LabelChip, MilestoneChip, ProjectChip, PullRequestChip, SubIssuesChip, TypeChip } from "../components/chips";
import { PriorityIcon, StatusIcon } from "../components/icons";
import { Avatar } from "../components/Avatar";

export interface IssueCardProps {
  issue: Issue;
  settings: Settings;
  properties: Record<PropKey, boolean>;
  /** Number of hidden sub-issues (only set when "Show sub-issues" is off). */
  subCount?: number;
}

/** Presentational preview card; the drag wrapper and click handling live in BoardColumn. */
export const IssueCard = memo(function IssueCard({ issue, settings, properties: p, subCount }: IssueCardProps) {
  const def = settings.statuses.find((s) => s.name === issue.status);
  const initial = issue.assignee?.trim().charAt(0).toUpperCase();
  return (
    <>
      <div className="kh-tickets-card-top">
        {p.id ? <span className="kh-tickets-card-id">{issue.id}</span> : <span />}
        {p.assignee && initial ? (
          <Avatar name={issue.assignee ?? ""} className="kh-tickets-card-avatar" />
        ) : null}
      </div>
      <div className="kh-tickets-card-title">{issue.title}</div>
      <div className="kh-tickets-card-chips">
        {p.status && (
          <span className="kh-tickets-card-icon" title={issue.status}>
            <StatusIcon category={def?.category ?? "backlog"} color={def?.color} />
          </span>
        )}
        {p.priority && (
          <span className="kh-tickets-card-icon" title="Priority">
            <PriorityIcon priority={issue.priority} />
          </span>
        )}
        {p.type && <TypeChip type={issue.type} />}
        {p.labels && issue.tags.map((t) => <LabelChip key={t} label={t} color={settings.labelColors[t]} />)}
        {p.project && issue.project && <ProjectChip project={issue.project} />}
        {p.due && issue.due && <DueChip due={issue.due} />}
        {p.milestone && issue.milestone && <MilestoneChip milestone={issue.milestone} />}
        {p.pullRequests && issue.pullRequests.length > 0 && <PullRequestChip urls={issue.pullRequests} />}
        {subCount ? <SubIssuesChip count={subCount} /> : null}
      </div>
    </>
  );
});
