import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Menu } from "obsidian";
import { useState } from "react";
import type { MilestoneProgress } from "../../../../../core/domain/milestones";
import type { Milestone } from "../../../../../core/domain/types";
import { DatePicker } from "../components/pickers/DatePicker";
import { Icon } from "../components/icons";

export interface MilestoneRowProps {
  milestone: Milestone;
  progress: MilestoneProgress;
  overdue: boolean;
  color: string;
  /** The Milestone filter currently selects exactly this milestone. */
  active: boolean;
  onToggleFilter: () => void;
  onRename: (name: string) => void;
  onPatch: (patch: { target?: string | null; description?: string | null }) => void;
  onDelete: () => void;
}

export function MilestoneRow({ milestone, progress, overdue, color, active, onToggleFilter, onRename, onPatch, onDelete }: MilestoneRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: milestone.name });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(milestone.name);
  const [desc, setDesc] = useState(milestone.description ?? "");
  const [dateAnchor, setDateAnchor] = useState<HTMLElement | null>(null);

  const begin = () => {
    setName(milestone.name);
    setDesc(milestone.description ?? "");
    setEditing(true);
  };
  const save = () => {
    setEditing(false);
    const n = name.trim();
    if (n !== "" && n !== milestone.name) onRename(n);
    const d = desc.trim();
    if (d !== (milestone.description ?? "")) onPatch({ description: d === "" ? null : d });
  };
  const keys = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") setEditing(false);
  };

  return (
    <li
      ref={setNodeRef}
      className={`kt-ms-row${active ? " is-active" : ""}${overdue ? " is-overdue" : ""}${isDragging ? " is-dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div className="kt-ms-main">
        <span className="kt-ms-grip" title="Drag to reorder" aria-label="Drag to reorder" {...attributes} {...listeners}>
          <Icon name="grip-vertical" size={14} />
        </span>
        <span className="kt-ms-diamond" style={{ color }}>
          <Icon name="diamond" size={14} />
        </span>
        {editing ? (
          <div className="kt-ms-edit">
            <input autoFocus className="kt-ms-name-input" value={name} placeholder="Milestone name" onChange={(e) => setName(e.target.value)} onKeyDown={keys} />
            <input className="kt-ms-desc-input" value={desc} placeholder="Description" onChange={(e) => setDesc(e.target.value)} onKeyDown={keys} />
            <span className="kt-ms-edit-actions">
              <button type="button" className="mod-cta" onClick={save}>
                Save
              </button>
              <button type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </span>
          </div>
        ) : (
          <button type="button" className="kt-ms-name" title="Filter issues to this milestone" onClick={onToggleFilter}>
            <span className="kt-ms-text">
              <span className="kt-ms-title">{milestone.name}</span>
              {milestone.description && <span className="kt-ms-desc">{milestone.description}</span>}
            </span>
          </button>
        )}
        <button type="button" className="kt-prop-btn kt-ms-date" title="Target date" onClick={(e) => setDateAnchor(e.currentTarget)}>
          <Icon name="calendar" />
          <span>{milestone.target ?? "Target date"}</span>
        </button>
        <span className="kt-ms-progress" title={`${progress.done} of ${progress.total} issues done`}>
          <span className="kt-ms-count">
            {progress.done}/{progress.total} · {progress.percent}%
          </span>
          <span className="kt-progress-bar kt-ms-bar">
            <span className="kt-progress-fill" style={{ width: `${progress.percent}%`, background: color }} />
          </span>
        </span>
        <button
          type="button"
          className="clickable-icon"
          title="More"
          aria-label="Milestone actions"
          onClick={(e) => {
            const m = new Menu();
            m.addItem((i) => i.setTitle("Edit").setIcon("pencil").onClick(begin));
            m.addItem((i) => i.setTitle("Delete milestone").setIcon("trash").setWarning(true).onClick(onDelete));
            m.showAtMouseEvent(e.nativeEvent);
          }}
        >
          <Icon name="more-horizontal" size={16} />
        </button>
      </div>
      {dateAnchor && (
        <DatePicker anchor={dateAnchor} value={milestone.target} onChange={(t) => onPatch({ target: t ?? null })} onClose={() => setDateAnchor(null)} />
      )}
    </li>
  );
}
