import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, type SortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { memo } from "react";
import type { DropKeys } from "../../core/dnd";
import type { PropKey } from "../../core/display";
import type { Group } from "../../core/query";
import type { Issue, Settings } from "../../core/types";
import { Icon, StatusIcon } from "../components/icons";
import { IssueCard } from "./IssueCard";

/** One droppable cell: a column, or a column inside a swimlane. */
export interface BoardCell {
  id: string;
  keys: DropKeys;
  issues: Issue[];
}

export const cellId = (keys: DropKeys): string => `cell:${keys.group}|${keys.sub ?? ""}`;
export const itemId = (issueId: string, cell: string): string => `${issueId}@${cell}`;

const noMove: SortingStrategy = () => null;

interface SortableCardProps {
  issue: Issue;
  cell: BoardCell;
  settings: Settings;
  properties: Record<PropKey, boolean>;
  subCount?: number;
  onOpen: (issue: Issue, newTab: boolean) => void;
}

const SortableCard = memo(function SortableCard({ issue, cell, settings, properties, subCount, onOpen }: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: itemId(issue.id, cell.id),
    data: { type: "card", issueId: issue.id, cellId: cell.id },
  });
  return (
    <div
      ref={setNodeRef}
      className={`kt-card${isDragging ? " is-dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={(e) => onOpen(issue, e.ctrlKey || e.metaKey)}
    >
      <IssueCard issue={issue} settings={settings} properties={properties} subCount={subCount} />
    </div>
  );
});

export interface BoardCellViewProps {
  cell: BoardCell;
  manual: boolean;
  isOver: boolean;
  settings: Settings;
  properties: Record<PropKey, boolean>;
  subCounts: ReadonlyMap<string, number>;
  onOpen: (issue: Issue, newTab: boolean) => void;
  /** Own scrollbar (no swimlanes) or grows with its content (swimlanes). */
  scroll: boolean;
}

export const BoardCellView = memo(function BoardCellView({
  cell, manual, isOver, settings, properties, subCounts, onOpen, scroll,
}: BoardCellViewProps) {
  const { setNodeRef } = useDroppable({ id: cell.id, data: { type: "cell", cellId: cell.id } });
  return (
    <div ref={setNodeRef} className={`kt-cell${scroll ? " is-scroll" : ""}${isOver ? " is-over" : ""}`}>
      <SortableContext items={cell.issues.map((i) => itemId(i.id, cell.id))} strategy={manual ? verticalListSortingStrategy : noMove}>
        {cell.issues.map((i) => (
          <SortableCard key={i.id} issue={i} cell={cell} settings={settings} properties={properties} subCount={subCounts.get(i.id)} onOpen={onOpen} />
        ))}
      </SortableContext>
    </div>
  );
});

export interface ColumnHeaderProps {
  group: Group;
  onAdd: () => void;
}

export function ColumnHeader({ group, onAdd }: ColumnHeaderProps) {
  return (
    <div className="kt-col-header">
      {group.status ? <StatusIcon category={group.status.category} color={group.status.color} /> : null}
      <span className="kt-group-name">{group.label}</span>
      <span className="kt-group-count">{group.issues.length}</span>
      <button type="button" className="kt-group-add" title={`New issue in ${group.label}`} onClick={onAdd}>
        <Icon name="plus" size={14} />
      </button>
    </div>
  );
}
