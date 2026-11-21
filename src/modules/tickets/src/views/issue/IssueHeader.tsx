import { Menu } from "obsidian";
import type { Issue } from "../../core/types";
import { fromLink } from "../../core/links";
import { Icon } from "../components/icons";

export interface IssueHeaderProps {
  issue: Issue;
  parent?: Issue;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenProject: (name: string) => void;
  onOpenIssue: (id: string) => void;
  onOpenMarkdown: () => void;
  onCopyId: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
}

export function IssueHeader(p: IssueHeaderProps) {
  const { issue, parent } = p;
  const project = issue.project ? fromLink(issue.project) : undefined;
  return (
    <div className="kt-header kt-issue-header">
      <nav className="kt-crumbs" aria-label="Breadcrumb">
        {project && (
          <>
            <button type="button" className="kt-crumb" onClick={() => p.onOpenProject(project)}>
              {project}
            </button>
            <span className="kt-crumb-sep">›</span>
          </>
        )}
        {parent && (
          <>
            <button type="button" className="kt-crumb" title={parent.title} onClick={() => p.onOpenIssue(parent.id)}>
              {parent.id} {parent.title}
            </button>
            <span className="kt-crumb-sep">›</span>
          </>
        )}
        <span className="kt-crumb is-current">{issue.id}</span>
      </nav>
      <span className="kt-spacer" />
      <button type="button" className="clickable-icon" title="Open as Markdown" aria-label="Open as Markdown" onClick={p.onOpenMarkdown}>
        <Icon name="file-text" size={16} />
      </button>
      <button type="button" className="clickable-icon" title="Copy ID" aria-label="Copy ID" onClick={p.onCopyId}>
        <Icon name="copy" size={16} />
      </button>
      <button
        type="button"
        className="clickable-icon"
        title="More"
        aria-label="More"
        onClick={(e) => {
          const m = new Menu();
          m.addItem((i) => i.setTitle("Copy link").setIcon("link").onClick(p.onCopyLink));
          m.addItem((i) => i.setTitle("Delete issue").setIcon("trash").setWarning(true).onClick(p.onDelete));
          m.showAtMouseEvent(e.nativeEvent);
        }}
      >
        <Icon name="more-horizontal" size={16} />
      </button>
      <button
        type="button"
        className="clickable-icon"
        title={p.sidebarOpen ? "Hide properties" : "Show properties"}
        aria-label="Toggle properties"
        onClick={p.onToggleSidebar}
      >
        <Icon name="panel-right" size={16} />
      </button>
    </div>
  );
}
