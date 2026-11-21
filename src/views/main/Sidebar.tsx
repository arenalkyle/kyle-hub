import { useRef, useState, type PointerEvent } from "react";
import { splitArchived } from "../../core/projects";
import { projectViewId } from "../../core/query";
import type { Project } from "../../core/types";
import { Icon, ProjectGlyph } from "../components/icons";

export const SIDEBAR_MIN = 160;
export const SIDEBAR_MAX = 480;

export interface SidebarProps {
  view: string;
  projects: readonly Project[];
  width: number;
  onSelect: (viewId: string) => void;
  onNewProject: () => void;
  onResize: (width: number, commit: boolean) => void;
}

const NAV: { id: string; label: string; icon: string }[] = [
  { id: "all", label: "All Issues", icon: "layers" },
  { id: "active", label: "Active", icon: "circle-dot" },
  { id: "backlog", label: "Backlog", icon: "inbox" },
];

const clamp = (w: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w));

export function Sidebar({ view, projects, width, onSelect, onNewProject, onResize }: SidebarProps) {
  const { active, archived } = splitArchived(projects);
  const [showArchived, setShowArchived] = useState(false);
  const archivedOpen = showArchived || archived.some((p) => projectViewId(p.name) === view);
  const drag = useRef<{ x: number; w: number } | null>(null);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, w: width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) onResize(clamp(drag.current.w + e.clientX - drag.current.x), false);
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onResize(clamp(drag.current.w + e.clientX - drag.current.x), true);
    drag.current = null;
  };

  const item = (id: string, label: string, icon: string) => (
    <button
      key={id}
      type="button"
      className={`kt-nav-item${view === id ? " is-active" : ""}`}
      onClick={() => onSelect(id)}
    >
      <Icon name={icon} size={14} />
      <span className="kt-nav-label">{label}</span>
    </button>
  );

  const projectItem = (p: Project) => (
    <button
      key={p.name}
      type="button"
      className={`kt-nav-item${view === projectViewId(p.name) ? " is-active" : ""}`}
      onClick={() => onSelect(projectViewId(p.name))}
    >
      <ProjectGlyph icon={p.icon} color={p.color} />
      <span className="kt-nav-label">{p.name}</span>
    </button>
  );

  return (
    <nav className="kt-sidebar" style={{ width }}>
      <div className="kt-sidebar-scroll">
        {NAV.map((n) => item(n.id, n.label, n.icon))}
        <div className="kt-nav-heading kt-nav-heading-row">
          <span>Projects</span>
          <button type="button" className="clickable-icon kt-nav-add" title="New project" aria-label="New project" onClick={onNewProject}>
            <Icon name="plus" size={14} />
          </button>
        </div>
        {projects.length === 0 && <div className="kt-nav-empty">No projects</div>}
        {active.map(projectItem)}
        {archived.length > 0 && (
          <>
            <button type="button" className="kt-nav-item kt-nav-archived" onClick={() => setShowArchived((v) => !v)}>
              <Icon name={archivedOpen ? "chevron-down" : "chevron-right"} size={14} />
              <span className="kt-nav-label">Archived</span>
              <span className="kt-nav-count">{archived.length}</span>
            </button>
            {archivedOpen && archived.map(projectItem)}
          </>
        )}
      </div>
      <div
        className="kt-resizer"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
    </nav>
  );
}
