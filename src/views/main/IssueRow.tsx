import { memo, type MouseEvent } from "react";
import type { Issue, Settings } from "../../core/types";
import { AssigneeChip, CreatedChip, DueChip, LabelChip, ProjectChip } from "../components/chips";
import { PriorityIcon, StatusIcon } from "../components/icons";

export interface IssueRowProps {
  issue: Issue;
  settings: Settings;
  onOpen: (issue: Issue, newTab: boolean) => void;
  onStatus: (issue: Issue, anchor: HTMLElement) => void;
  onPriority: (issue: Issue, anchor: HTMLElement) => void;
}

export const IssueRow = memo(function IssueRow({ issue, settings, onOpen, onStatus, onPriority }: IssueRowProps) {
  const def = settings.statuses.find((s) => s.name === issue.status);
  const stop = (fn: (anchor: HTMLElement) => void) => (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    fn(e.currentTarget);
  };
  return (
    <div className="kt-row" onClick={(e) => onOpen(issue, e.ctrlKey || e.metaKey)}>
      <button type="button" className="kt-row-btn" title="Priority" onClick={stop((a) => onPriority(issue, a))}>
        <PriorityIcon priority={issue.priority} />
      </button>
      <span className="kt-row-id">{issue.id}</span>
      <button type="button" className="kt-row-btn" title={issue.status} onClick={stop((a) => onStatus(issue, a))}>
        <StatusIcon category={def?.category ?? "backlog"} color={def?.color} />
      </button>
      <span className="kt-row-title">{issue.title}</span>
      <span className="kt-row-chips">
        {issue.tags.map((t) => (
          <LabelChip key={t} label={t} color={settings.labelColors[t]} />
        ))}
        {issue.project && <ProjectChip project={issue.project} />}
        {issue.due && <DueChip due={issue.due} />}
        {issue.assignee && <AssigneeChip assignee={issue.assignee} />}
        {issue.created && <CreatedChip created={issue.created} />}
      </span>
    </div>
  );
});
