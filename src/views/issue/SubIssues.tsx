import { useMemo, useState } from "react";
import { orderSubIssues, subIssueProgress } from "../../core/activity";
import type { Issue, Settings } from "../../core/types";
import { AssigneeChip } from "../components/chips";
import { StatusIcon } from "../components/icons";
import { StatusPicker } from "../components/pickers/StatusPicker";

export interface SubIssuesProps {
  children: readonly Issue[];
  settings: Settings;
  onOpen: (issue: Issue, newTab: boolean) => void;
  onStatus: (issue: Issue, status: string) => void;
  onAdd: () => void;
}

export function SubIssues({ children, settings, onOpen, onStatus, onAdd }: SubIssuesProps) {
  const [picker, setPicker] = useState<{ issue: Issue; anchor: HTMLElement } | null>(null);
  const ordered = useMemo(() => orderSubIssues(children, settings.statuses), [children, settings.statuses]);
  const { done, total } = subIssueProgress(children, settings.statuses);
  return (
    <section className="kt-subissues">
      <div className="kt-section-head">
        <h3 className="kt-section-title">Sub-issues</h3>
        {total > 0 && <span className="kt-subissues-count">{done}/{total}</span>}
        <span className="kt-spacer" />
        <button type="button" className="kt-link-btn" onClick={onAdd}>+ Add sub-issue</button>
      </div>
      {ordered.map((c) => {
        const def = settings.statuses.find((s) => s.name === c.status);
        return (
          <div key={c.id} className="kt-subissue" onClick={(e) => onOpen(c, e.ctrlKey || e.metaKey)}>
            <button
              type="button"
              className="kt-row-btn"
              title={c.status}
              onClick={(e) => {
                e.stopPropagation();
                setPicker({ issue: c, anchor: e.currentTarget });
              }}
            >
              <StatusIcon category={def?.category ?? "backlog"} color={def?.color} />
            </button>
            <span className="kt-row-id">{c.id}</span>
            <span className="kt-row-title">{c.title}</span>
            {c.assignee && <AssigneeChip assignee={c.assignee} />}
          </div>
        );
      })}
      {picker && (
        <StatusPicker
          anchor={picker.anchor}
          value={picker.issue.status}
          onChange={(s) => onStatus(picker.issue, s)}
          onClose={() => setPicker(null)}
        />
      )}
    </section>
  );
}
