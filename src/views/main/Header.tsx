import { useState } from "react";
import type { DisplayState } from "../../core/display";
import { Icon } from "../components/icons";
import { DisplayPopover } from "./DisplayPopover";

export interface HeaderProps {
  title: string;
  count: number;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onNewIssue: () => void;
  display: DisplayState;
  onDisplayChange: (next: DisplayState) => void;
  onDisplayReset: () => void;
}

export function Header({ title, count, sidebarCollapsed, onToggleSidebar, onNewIssue, display, onDisplayChange, onDisplayReset }: HeaderProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
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
      <div className="kt-toggle">
        <button type="button" className={display.layout === "list" ? "is-active" : ""} onClick={() => onDisplayChange({ ...display, layout: "list" })}>
          List
        </button>
        <button type="button" className={display.layout === "board" ? "is-active" : ""} onClick={() => onDisplayChange({ ...display, layout: "board" })}>
          Board
        </button>
      </div>
      <button type="button" className="kt-header-btn" disabled title="Filters come later">
        <Icon name="list-filter" size={14} /> Filter
      </button>
      <button type="button" className="kt-header-btn" onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
        <Icon name="sliders-horizontal" size={14} /> Display
      </button>
      {anchor && (
        <DisplayPopover
          anchor={anchor}
          display={display}
          onChange={onDisplayChange}
          onReset={onDisplayReset}
          onClose={() => setAnchor(null)}
        />
      )}
      <button type="button" className="mod-cta" onClick={onNewIssue}>
        New issue
      </button>
    </div>
  );
}
