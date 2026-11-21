import { Menu } from "obsidian";
import type { Issue } from "../../../../../core/domain/types";
import { fromLink } from "../../../../../core/domain/links";
import { TypeChip } from "../components/chips";
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
    <div className="kh-tickets-header kh-tickets-issue-header">
      <nav className="kh-tickets-crumbs" aria-label="Breadcrumb">
        {project && (
          <>
            <button type="button" className="kh-tickets-crumb" onClick={() => p.onOpenProject(project)}>
              {project}
            </button>
            <span className="kh-tickets-crumb-sep">›</span>
          </>
        )}
        {parent && (
          <>
            <button type="button" className="kh-tickets-crumb" title={parent.title} onClick={() => p.onOpenIssue(parent.id)}>
              {parent.id} {parent.title}
            </button>
            <span className="kh-tickets-crumb-sep">›</span>
          </>
        )}
        <span className="kh-tickets-crumb is-current">{issue.id}</span>
        <TypeChip type={issue.type} />
      </nav>
      <span className="kh-tickets-spacer" />
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
