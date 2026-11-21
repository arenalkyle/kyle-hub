import { useEffect, useState, type ReactNode } from "react";
import type { IssuePatch } from "../../core/issueFile";
import { fromLink } from "../../core/links";
import { relativeTime } from "../../core/time";
import type { Issue, Settings } from "../../core/types";
import { DueChip, LabelChip, shortDate } from "../components/chips";
import { Icon, PriorityIcon, StatusIcon } from "../components/icons";
import { AssigneePicker } from "../components/pickers/AssigneePicker";
import { DatePicker } from "../components/pickers/DatePicker";
import { LabelPicker } from "../components/pickers/LabelPicker";
import { MilestonePicker } from "../components/pickers/MilestonePicker";
import { PriorityPicker } from "../components/pickers/PriorityPicker";
import { ProjectPicker } from "../components/pickers/ProjectPicker";
import { StatusPicker } from "../components/pickers/StatusPicker";

export type PropKind = "status" | "priority" | "assignee" | "labels" | "project" | "milestone" | "due";

export interface PropertiesSidebarProps {
  issue: Issue;
  settings: Settings;
  /** Picker currently open (set by shortcuts or clicks) and the element it anchors to. */
  open: { kind: PropKind; anchor: HTMLElement | null } | null;
  onOpen: (kind: PropKind, anchor: HTMLElement) => void;
  onClose: () => void;
  onUpdate: (patch: IssuePatch) => void;
}

const PRIORITY_LABELS: Record<string, string> = {
  none: "No priority", urgent: "Urgent", high: "High", medium: "Medium", low: "Low",
};

function Row({ kind, label, onOpen, children }: { kind: PropKind; label: string; onOpen: PropertiesSidebarProps["onOpen"]; children: ReactNode }) {
  return (
    <div className="kt-prop">
      <span className="kt-prop-label">{label}</span>
      <button type="button" className="kt-prop-value" data-kt-prop={kind} onClick={(e) => onOpen(kind, e.currentTarget)}>
        {children}
      </button>
    </div>
  );
}

const Empty = ({ text }: { text: string }) => <span className="kt-prop-empty">{text}</span>;

function TimeRow({ label, value }: { label: string; value?: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="kt-prop">
      <span className="kt-prop-label">{label}</span>
      <span className="kt-prop-static" title={value ?? ""}>
        {value ? (relativeTime(value, now) ?? shortDate(value)) : "-"}
      </span>
    </div>
  );
}

function prLabel(url: string): string {
  const m = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url);
  return m ? `${m[1]}#${m[2]}` : url;
}

export function PropertiesSidebar({ issue, settings, open, onOpen, onClose, onUpdate }: PropertiesSidebarProps) {
  const def = settings.statuses.find((s) => s.name === issue.status);
  const project = issue.project ? fromLink(issue.project) : undefined;
  const anchor = open?.anchor ?? null;
  return (
    <aside className="kt-issue-side">
      <div className="kt-prop-group-title">Properties</div>
      <Row kind="status" label="Status" onOpen={onOpen}>
        <StatusIcon category={def?.category ?? "backlog"} color={def?.color} />
        <span>{issue.status}</span>
      </Row>
      <Row kind="priority" label="Priority" onOpen={onOpen}>
        <PriorityIcon priority={issue.priority} />
        <span>{PRIORITY_LABELS[issue.priority] ?? issue.priority}</span>
      </Row>
      <Row kind="assignee" label="Assignee" onOpen={onOpen}>
        {issue.assignee ? (
          <>
            <Icon name="user" size={14} />
            <span>{issue.assignee}</span>
          </>
        ) : (
          <Empty text="Assign" />
        )}
      </Row>
      <Row kind="labels" label="Labels" onOpen={onOpen}>
        {issue.tags.length > 0 ? (
          <span className="kt-prop-chips">
            {issue.tags.map((t) => (
              <LabelChip key={t} label={t} color={settings.labelColors[t]} />
            ))}
          </span>
        ) : (
          <Empty text="Add label" />
        )}
      </Row>
      <Row kind="project" label="Project" onOpen={onOpen}>
        {project ? (
          <>
            <Icon name="box" size={14} />
            <span>{project}</span>
          </>
        ) : (
          <Empty text="Add to project" />
        )}
      </Row>
      <Row kind="milestone" label="Milestone" onOpen={onOpen}>
        {issue.milestone ? (
          <>
            <Icon name="milestone" size={14} />
            <span>{issue.milestone}</span>
          </>
        ) : (
          <Empty text="Add milestone" />
        )}
      </Row>
      <Row kind="due" label="Due date" onOpen={onOpen}>
        {issue.due ? <DueChip due={issue.due} /> : <Empty text="Set due date" />}
      </Row>

      <div className="kt-prop-group-title">Details</div>
      <TimeRow label="Created" value={issue.created} />
      <TimeRow label="Updated" value={issue.updated} />

      <div className="kt-prop-group-title">Pull requests</div>
      {issue.pullRequests.length === 0 ? (
        <div className="kt-prop-empty kt-prop-pad">None</div>
      ) : (
        <ul className="kt-prs">
          {issue.pullRequests.map((u) => (
            <li key={u}>
              <a href={u} className="external-link" title={u}>
                {prLabel(u)}
              </a>
            </li>
          ))}
        </ul>
      )}

      {open?.kind === "status" && <StatusPicker anchor={anchor} value={issue.status} onChange={(status) => onUpdate({ status })} onClose={onClose} />}
      {open?.kind === "priority" && <PriorityPicker anchor={anchor} value={issue.priority} onChange={(priority) => onUpdate({ priority })} onClose={onClose} />}
      {open?.kind === "assignee" && <AssigneePicker anchor={anchor} value={issue.assignee} onChange={(a) => onUpdate({ assignee: a ?? null })} onClose={onClose} />}
      {open?.kind === "labels" && <LabelPicker anchor={anchor} value={issue.tags} onChange={(tags) => onUpdate({ tags })} onClose={onClose} />}
      {open?.kind === "project" && (
        <ProjectPicker
          anchor={anchor}
          value={project}
          onChange={(p) => onUpdate({ project: p ?? null, ...(issue.milestone ? { milestone: null } : {}) })}
          onClose={onClose}
        />
      )}
      {open?.kind === "milestone" && (
        <MilestonePicker anchor={anchor} project={issue.project} value={issue.milestone} onChange={(m) => onUpdate({ milestone: m ?? null })} onClose={onClose} />
      )}
      {open?.kind === "due" && <DatePicker anchor={anchor} value={issue.due} onChange={(due) => onUpdate({ due: due ?? null })} onClose={onClose} />}
    </aside>
  );
}
