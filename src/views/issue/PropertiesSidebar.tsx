import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { IssuePatch } from "../../core/issueFile";
import { fromLink } from "../../core/links";
import { prLabel, prLabelOfUrl } from "../../core/pr";
import { relativeTime } from "../../core/time";
import { useProjects, usePrs } from "../../store/hooks";
import { findProjectByLink } from "../../core/projects";
import type { Issue, Settings } from "../../core/types";
import { DueChip, LabelChip, PrStateIcon, shortDate } from "../components/chips";
import { Icon, PriorityIcon, ProjectGlyph, StatusIcon } from "../components/icons";
import { Avatar } from "../components/Avatar";
import { AssigneePicker } from "../components/pickers/AssigneePicker";
import { DatePicker } from "../components/pickers/DatePicker";
import { LabelPicker } from "../components/pickers/LabelPicker";
import { MilestonePicker } from "../components/pickers/MilestonePicker";
import { PriorityPicker } from "../components/pickers/PriorityPicker";
import { ProjectPicker } from "../components/pickers/ProjectPicker";
import { StatusPicker } from "../components/pickers/StatusPicker";
import { RelatedSection } from "./RelatedSection";

export type PropKind = "status" | "priority" | "assignee" | "labels" | "project" | "milestone" | "due";

export interface PropertiesSidebarProps {
  issue: Issue;
  settings: Settings;
  /** Picker currently open (set by shortcuts or clicks) and the element it anchors to. */
  open: { kind: PropKind; anchor: HTMLElement | null } | null;
  onOpen: (kind: PropKind, anchor: HTMLElement) => void;
  onClose: () => void;
  onUpdate: (patch: IssuePatch) => void;
  /** Links a PR url; rejects with a user-facing message when invalid. */
  onLinkPr: (url: string) => Promise<void>;
  onUnlinkPr: (url: string) => void;
  onOpenIssue: (id: string) => void;
  onAddRelated: (otherId: string) => void;
  onRemoveRelated: (otherId: string) => void;
}

const PRIORITY_LABELS: Record<string, string> = {
  none: "No priority", urgent: "Urgent", high: "High", medium: "Medium", low: "Low",
};

function Row({ kind, label, onOpen, children }: { kind: PropKind; label: string; onOpen: PropertiesSidebarProps["onOpen"]; children: ReactNode }) {
  return (
    <div className="kt-prop">
      <button type="button" className="kt-prop-value" data-kt-prop={kind} title={label} aria-label={label} onClick={(e) => onOpen(kind, e.currentTarget)}>
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
      <span className="kt-prop-static" title={value ?? ""}>
        {label} {value ? (relativeTime(value, now) ?? shortDate(value)) : "-"}
      </span>
    </div>
  );
}

const STATE_LABEL = { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" } as const;

function PullRequests({ urls, onLink, onUnlink }: { urls: readonly string[]; onLink: (url: string) => Promise<void>; onUnlink: (url: string) => void }) {
  const prs = usePrs(urls);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (!text.trim()) return;
    onLink(text).then(
      () => {
        setText("");
        setError("");
        setAdding(false);
      },
      (err: unknown) => setError(err instanceof Error ? err.message : "Could not link the pull request."),
    );
  };
  return (
    <>
      {prs.length === 0 && !adding && <div className="kt-prop-empty kt-prop-pad">None</div>}
      <ul className="kt-prs">
        {prs.map((p) => (
          <li key={p.url} className="kt-pr-row">
            <a href={p.canonical ?? p.url} className="external-link kt-pr-link" title={p.info?.title ?? p.url}>
              {p.info && <PrStateIcon state={p.info.state} size={14} />}
              <span className="kt-pr-text">
                {p.info ? `${prLabel(p.info)} · ${p.info.title}` : prLabelOfUrl(p.url)}
              </span>
            </a>
            {p.info && <span className={`kt-pr-badge kt-pr-${p.info.state}`}>{STATE_LABEL[p.info.state]}</span>}
            <button type="button" className="kt-pr-remove clickable-icon" aria-label="Unlink pull request" title="Unlink" onClick={() => onUnlink(p.url)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      {adding ? (
        <form className="kt-pr-add" onSubmit={submit}>
          <input
            autoFocus
            type="text"
            placeholder="https://github.com/owner/repo/pull/123"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                setAdding(false);
                setError("");
              }
            }}
          />
          {error && <div className="kt-pr-error">{error}</div>}
        </form>
      ) : (
        <button type="button" className="kt-prop-value kt-pr-link-btn" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} />
          <span>Link PR</span>
        </button>
      )}
    </>
  );
}

export function PropertiesSidebar({ issue, settings, open, onOpen, onClose, onUpdate, onLinkPr, onUnlinkPr, onOpenIssue, onAddRelated, onRemoveRelated }: PropertiesSidebarProps) {
  const def = settings.statuses.find((s) => s.name === issue.status);
  const project = issue.project ? fromLink(issue.project) : undefined;
  const projectDef = findProjectByLink(useProjects(), issue.project);
  const anchor = open?.anchor ?? null;
  return (
    <aside className="kt-issue-side">
      <div className="kt-prop-group-title">Pull requests</div>
      <PullRequests urls={issue.pullRequests} onLink={onLinkPr} onUnlink={onUnlinkPr} />


      <div className="kt-prop-group-title">Properties</div>
      <Row kind="status" label="Status" onOpen={onOpen}>
        <StatusIcon category={def?.category ?? "backlog"} color={def?.color} />
        <span>{issue.status}</span>
      </Row>
      <Row kind="priority" label="Priority" onOpen={onOpen}>
        {issue.priority === "none" ? (
          <>
            <PriorityIcon priority={issue.priority} />
            <Empty text="Set priority" />
          </>
        ) : (
          <>
            <PriorityIcon priority={issue.priority} />
            <span>{PRIORITY_LABELS[issue.priority] ?? issue.priority}</span>
          </>
        )}
      </Row>
      <Row kind="assignee" label="Assignee" onOpen={onOpen}>
        {issue.assignee ? (
          <>
            <Avatar name={issue.assignee} className="kt-prop-avatar" />
            <span>{issue.assignee}</span>
          </>
        ) : (
          <>
            <Icon name="user" size={14} />
            <Empty text="Assign" />
          </>
        )}
      </Row>
      <Row kind="milestone" label="Milestone" onOpen={onOpen}>
        {issue.milestone ? (
          <>
            <span className="kt-icon kt-ms-icon" style={projectDef?.color ? { color: projectDef.color } : undefined}>
              <Icon name="milestone" size={14} />
            </span>
            <span>{issue.milestone}</span>
          </>
        ) : (
          <Empty text="Add milestone" />
        )}
      </Row>
      <Row kind="due" label="Due date" onOpen={onOpen}>
        {issue.due ? <DueChip due={issue.due} /> : <Empty text="Set due date" />}
      </Row>


      <div className="kt-prop-group-title">Labels</div>
      <div className="kt-prop">
        <button type="button" className="kt-prop-value kt-prop-labels" data-kt-prop="labels" title="Labels" aria-label="Labels" onClick={(e) => onOpen("labels", e.currentTarget)}>
          {issue.tags.length > 0 ? (
            <span className="kt-prop-chips">
              {issue.tags.map((t) => (
                <LabelChip key={t} label={t} color={settings.labelColors[t]} />
              ))}
              <span className="kt-prop-plus"><Icon name="plus" size={14} /></span>
            </span>
          ) : (
            <>
              <Icon name="plus" size={14} />
              <Empty text="Add label" />
            </>
          )}
        </button>
      </div>

      <div className="kt-prop-group-title">Project</div>
      <Row kind="project" label="Project" onOpen={onOpen}>
        {project ? (
          <>
            <ProjectGlyph icon={projectDef?.icon} color={projectDef?.color} size={14} />
            <span>{project}</span>
          </>
        ) : (
          <Empty text="Add to project" />
        )}
      </Row>

      <RelatedSection issue={issue} settings={settings} onOpenIssue={onOpenIssue} onAdd={onAddRelated} onRemove={onRemoveRelated} />

      <div className="kt-prop-group-title">Details</div>
      <TimeRow label="Created" value={issue.created} />
      <TimeRow label="Updated" value={issue.updated} />


      {open?.kind === "status" && <StatusPicker anchor={anchor} value={issue.status} onChange={(status) => onUpdate({ status })} onClose={onClose} />}
      {open?.kind === "priority" && <PriorityPicker anchor={anchor} value={issue.priority} onChange={(priority) => onUpdate({ priority })} onClose={onClose} />}
      {open?.kind === "assignee" && <AssigneePicker anchor={anchor} value={issue.assignee} onChange={(a) => onUpdate({ assignee: a ?? null })} onClose={onClose} />}
      {open?.kind === "labels" && <LabelPicker anchor={anchor} value={issue.tags} onChange={(tags) => onUpdate({ tags })} onClose={onClose} />}
      {open?.kind === "project" && (
        <ProjectPicker
          anchor={anchor}
          value={project}
          onChange={(p) => onUpdate({ project: p ?? null })}
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
