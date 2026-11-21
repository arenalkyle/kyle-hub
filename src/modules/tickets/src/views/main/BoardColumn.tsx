import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, type SortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { memo } from "react";
import type { DropKeys } from "../../../../../core/domain/dnd";
import type { PropKey } from "../../../../../core/domain/display";
import type { Group } from "../../../../../core/domain/query";
import type { Issue, Settings } from "../../../../../core/domain/types";
import { Icon, StatusIcon } from "../components/icons";
import { IssueCard } from "./IssueCard";

/** One droppable cell: a column, or a column inside a swimlane. */
export interface BoardCell {
  id: string;
  keys: DropKeys;
  issues: Issue[];
}

/** Values are encoded so separators inside group names ("In Progress", "a|b", "x@y") can't alter the id's structure. */
export const cellId = (keys: DropKeys): string =>
  `cell:${encodeURIComponent(keys.group)}|${encodeURIComponent(keys.sub ?? "")}`;
export const itemId = (issueId: string, cell: string): string => `${encodeURIComponent(issueId)}@${cell}`;

const noMove: SortingStrategy = () => null;

interface SortableCardProps {
  issue: Issue;
  cell: BoardCell;
  settings: Settings;
  properties: Record<PropKey, boolean>;
  subCount?: number;
  selected: boolean;
  onOpen: (issue: Issue, newTab: boolean) => void;
}

const SortableCard = memo(function SortableCard({ issue, cell, settings, properties, subCount, selected, onOpen }: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: itemId(issue.id, cell.id),
    data: { type: "card", issueId: issue.id, cellId: cell.id },
  });
  return (
    <div
      ref={setNodeRef}
      className={`kh-tickets-card${isDragging ? " is-dragging" : ""}${selected ? " is-selected" : ""}`}
      data-kh-tickets-id={issue.id}
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
  selectedId: string | null;
  onOpen: (issue: Issue, newTab: boolean) => void;
  /** Own scrollbar (no swimlanes) or grows with its content (swimlanes). */
  scroll: boolean;
}

export const BoardCellView = memo(function BoardCellView({
  cell, manual, isOver, settings, properties, subCounts, selectedId, onOpen, scroll,
}: BoardCellViewProps) {
  const { setNodeRef } = useDroppable({ id: cell.id, data: { type: "cell", cellId: cell.id } });
  return (
    <div ref={setNodeRef} className={`kh-tickets-cell${scroll ? " is-scroll" : ""}${isOver ? " is-over" : ""}`}>
      <SortableContext items={cell.issues.map((i) => itemId(i.id, cell.id))} strategy={manual ? verticalListSortingStrategy : noMove}>
        {cell.issues.map((i) => (
          <SortableCard key={i.id} issue={i} cell={cell} settings={settings} properties={properties} subCount={subCounts.get(i.id)} selected={i.id === selectedId} onOpen={onOpen} />
        ))}
      </SortableContext>
    </div>
  );
});

export interface ColumnHeaderProps {
  group: Group;
  onAdd: () => void;
  /** Hide this column (right-click or the "..." button). */
  onHide?: () => void;
}

export function ColumnHeader({ group, onAdd, onHide }: ColumnHeaderProps) {
  return (
    <div
      className="kh-tickets-col-header"
      onContextMenu={
        onHide
          ? (e) => {
              e.preventDefault();
              onHide();
            }
          : undefined
      }
    >
      {group.status ? <StatusIcon category={group.status.category} color={group.status.color} /> : null}
      <span className="kh-tickets-group-name">{group.label}</span>
      <span className="kh-tickets-group-count">{group.issues.length}</span>
      <button type="button" className="kh-tickets-group-add" title={`New issue in ${group.label}`} onClick={onAdd}>
        <Icon name="plus" size={14} />
      </button>
      {onHide && (
        <button type="button" className="kh-tickets-group-add kh-tickets-col-hide" title="Hide column" onClick={onHide}>
          <Icon name="eye-off" size={14} />
        </button>
      )}
    </div>
  );
}
