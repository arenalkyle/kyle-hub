import { Icon } from "../components/icons";

export interface HeaderProps {
  title: string;
  count: number;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onNewIssue: () => void;
}

export function Header({ title, count, sidebarCollapsed, onToggleSidebar, onNewIssue }: HeaderProps) {
  return (
    <div className="kt-header">
      <button
        type="button"
        className="kt-icon-btn"
        title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
        onClick={onToggleSidebar}
      >
        <Icon name="panel-left" size={16} />
      </button>
      <h2 className="kt-header-title">{title}</h2>
      <span className="kt-header-count">{count}</span>
      <div className="kt-header-spacer" />
      <div className="kt-toggle" title="Board comes later">
        <button type="button" className="is-active">List</button>
        <button type="button" disabled>Board</button>
      </div>
      <button type="button" className="kt-header-btn" disabled title="Filters come later">
        <Icon name="list-filter" size={14} /> Filter
      </button>
      <button type="button" className="kt-header-btn" disabled title="Display options come later">
        <Icon name="sliders-horizontal" size={14} /> Display
      </button>
      <button type="button" className="mod-cta" onClick={onNewIssue}>
        New issue
      </button>
    </div>
  );
}
