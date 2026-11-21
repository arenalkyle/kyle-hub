import { memo } from "react";
import type { PropKey } from "../../../../../core/domain/display";
import type { Issue, Settings } from "../../../../../core/domain/types";
import { DueChip, LabelChip, MilestoneChip, ProjectChip, PullRequestChip, SubIssuesChip } from "../components/chips";
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
      <div className="kt-card-top">
        {p.id ? <span className="kt-card-id">{issue.id}</span> : <span />}
        {p.assignee && initial ? (
          <Avatar name={issue.assignee ?? ""} className="kt-card-avatar" />
        ) : null}
      </div>
      <div className="kt-card-title">{issue.title}</div>
      <div className="kt-card-chips">
        {p.status && (
          <span className="kt-card-icon" title={issue.status}>
            <StatusIcon category={def?.category ?? "backlog"} color={def?.color} />
          </span>
        )}
        {p.priority && (
          <span className="kt-card-icon" title="Priority">
            <PriorityIcon priority={issue.priority} />
          </span>
        )}
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
