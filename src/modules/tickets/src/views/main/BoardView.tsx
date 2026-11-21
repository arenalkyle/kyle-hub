import {
  closestCorners, DndContext, pointerWithin, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Notice, TFile } from "obsidian";
import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { dropToPatch, planReorder, type DropKeys } from "../../../../../core/domain/dnd";
import { ORDER_BY_LABELS, type DisplayState } from "../../../../../core/domain/display";
import type { IssuePatch } from "../../../../../core/domain/issueFile";
import { OTHER_GROUP_KEY, type Group } from "../../../../../core/domain/query";
import { PRIORITY_ORDER } from "../../../../../core/domain/defaults";
import type { Issue } from "../../../../../core/domain/types";
import { Icon, StatusIcon } from "../components/icons";
import { usePlugin } from "../PluginContext";
import { BoardCellView, ColumnHeader, cellId, type BoardCell } from "./BoardColumn";
import { IssueCard } from "./IssueCard";
import { presetFor } from "./ListView";

export interface BoardMove {
  id: string;
  patch: IssuePatch;
}

export interface BoardViewProps {
  groups: Group[];
  display: DisplayState;
  subCounts: ReadonlyMap<string, number>;
  /** Issues as currently displayed (including optimistic changes), for lookups. */
  issues: readonly Issue[];
  project?: string;
  selectedId: string | null;
  collapsed: ReadonlySet<string>;
  onToggleGroup: (key: string) => void;
  /** Hide a column (group key). */
  onHideGroup?: (key: string) => void;
  /** Applies the moves optimistically and writes them via the store. */
  onMove: (moves: BoardMove[]) => void;
}

interface Lane {
  key: string;
  label: string;
  status?: Group["status"];
  rank: number;
}

const laneKey = (leaf: string): string => `lane:${leaf}`;
const leafOf = (parent: Group, sub: Group): string => sub.key.slice(parent.key.length + 1);

function laneRank(display: DisplayState, leaf: string, statusOrder: ReadonlyMap<string, number>): number {
  if (display.subGroupBy === "status") return statusOrder.get(leaf.replace(/^status:/, "")) ?? 1e6;
  if (display.subGroupBy === "priority") return PRIORITY_ORDER.indexOf(leaf.replace(/^priority:/, "") as never);
  return leaf.startsWith("none:") || leaf === OTHER_GROUP_KEY ? 1e6 : 0;
}

/** Follow the pointer (the overlay can sit offset from it); fall back to corners for keyboard drags and gaps. */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : closestCorners(args);
};

export function BoardView({ groups, display, subCounts, issues, project, selectedId, collapsed, onToggleGroup, onHideGroup, onMove }: BoardViewProps) {
  const plugin = usePlugin();
  const { settings } = plugin.data;
  const manual = display.orderBy === "manual";
  const hasLanes = display.subGroupBy !== "none" && display.subGroupBy !== display.groupBy;

  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const [overCell, setOverCell] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const open = useCallback(
    (issue: Issue, newTab: boolean) => {
      const path = plugin.store.pathOf(issue.id);
      const f = path ? plugin.app.vault.getAbstractFileByPath(path) : null;
      if (f instanceof TFile) void plugin.app.workspace.getLeaf(newTab ? "tab" : false).openFile(f);
    },
    [plugin],
  );

  const issueById = useMemo(() => new Map(issues.map((i) => [i.id, i])), [issues]);

  /** Lanes (swimlanes) and the cell for each column, plus an id -> cell index for drag handling. */
  const layout = useMemo(() => {
    const cells = new Map<string, BoardCell>();
    const lanes = new Map<string, Lane>();
    const statusOrder = new Map(settings.statuses.map((s) => [s.name, s.order]));
    const columns = groups.map((g) => {
      if (!hasLanes) {
        const keys: DropKeys = { group: g.key };
        const cell: BoardCell = { id: cellId(keys), keys, issues: g.issues };
        cells.set(cell.id, cell);
        return { group: g, cell, byLane: new Map<string, BoardCell>() };
      }
      const byLane = new Map<string, BoardCell>();
      for (const s of g.subgroups ?? []) {
        const leaf = leafOf(g, s);
        const keys: DropKeys = { group: g.key, sub: leaf };
        const cell: BoardCell = { id: cellId(keys), keys, issues: s.issues };
        cells.set(cell.id, cell);
        byLane.set(leaf, cell);
        if (!lanes.has(leaf)) lanes.set(leaf, { key: leaf, label: s.label, status: s.status, rank: laneRank(display, leaf, statusOrder) });
      }
      return { group: g, cell: undefined, byLane };
    });
    const laneList = [...lanes.values()].sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    for (const c of columns) {
      for (const lane of laneList) {
        if (c.byLane.has(lane.key)) continue;
        const keys: DropKeys = { group: c.group.key, sub: lane.key };
        const cell: BoardCell = { id: cellId(keys), keys, issues: [] };
        cells.set(cell.id, cell);
        c.byLane.set(lane.key, cell);
      }
    }
    return { cells, columns, lanes: laneList };
  }, [groups, hasLanes, display, settings.statuses]);

  const cellOfEvent = (data: Record<string, unknown> | undefined): string | null =>
    typeof data?.cellId === "string" ? data.cellId : null;

  const onDragStart = (e: DragStartEvent) => setActiveIssueId(String(e.active.data.current?.issueId ?? ""));
  const onDragOver = (e: DragOverEvent) => {
    const next = e.over ? cellOfEvent(e.over.data.current) : null;
    setOverCell((cur) => (cur === next ? cur : next));
  };
  const reset = () => {
    setActiveIssueId(null);
    setOverCell(null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    reset();
    const { active, over } = e;
    if (!over) return;
    const issue = issueById.get(String(active.data.current?.issueId));
    const from = layout.cells.get(String(active.data.current?.cellId));
    const toId = cellOfEvent(over.data.current);
    const to = toId ? layout.cells.get(toId) : undefined;
    if (!issue || !from || !to) return;

    const patch = dropToPatch(display.groupBy, display.subGroupBy, from.keys, to.keys, issue);
    if (patch === null) {
      new Notice("Can't move the card there.");
      return;
    }
    const moves: BoardMove[] = [];
    const sameCell = from.id === to.id;
    if (manual) {
      // Position of the dragged card within the target cell's order.
      const without = to.issues.filter((i) => i.id !== issue.id);
      let index: number;
      if (over.data.current?.type === "card") {
        const overIssue = String(over.data.current.issueId);
        const oldIdx = to.issues.findIndex((i) => i.id === issue.id);
        const overIdx = to.issues.findIndex((i) => i.id === overIssue);
        if (sameCell) {
          if (oldIdx === overIdx) return;
          index = arrayMove(to.issues, oldIdx, overIdx).findIndex((i) => i.id === issue.id);
        } else {
          const r = active.rect.current.translated;
          const mid = over.rect.top + over.rect.height / 2;
          const below = r ? r.top + r.height / 2 > mid : false;
          index = without.findIndex((i) => i.id === overIssue) + (below ? 1 : 0);
        }
      } else {
        index = without.length;
      }
      const next = [...without.slice(0, index), issue, ...without.slice(index)];
      const orders = planReorder(next, issue.id);
      for (const [id, sortOrder] of Object.entries(orders)) {
        moves.push({ id, patch: id === issue.id ? { ...patch, sortOrder } : { sortOrder } });
      }
    } else if (Object.keys(patch).length) {
      moves.push({ id: issue.id, patch });
    }
    if (moves.length) onMove(moves);
  };

  const active = activeIssueId ? issueById.get(activeIssueId) : undefined;

  const header = (g: Group) => (
    <ColumnHeader key={g.key} group={g} onAdd={() => plugin.openNewIssue({ project, ...presetFor([g]) })} onHide={onHideGroup ? () => onHideGroup(g.key) : undefined} />
  );
  const cellView = (cell: BoardCell, scroll: boolean) => (
    <BoardCellView
      key={cell.id}
      cell={cell}
      manual={manual}
      isOver={overCell === cell.id}
      settings={settings}
      properties={display.properties}
      subCounts={subCounts}
      selectedId={selectedId}
      onOpen={open}
      scroll={scroll}
    />
  );

  return (
    <div className="kh-tickets-board-wrap">
      {!manual && (
        <div className="kh-tickets-board-hint">
          Cards are ordered by {ORDER_BY_LABELS[display.orderBy].toLowerCase()}. Set Ordering to Manual in Display to reorder within a column.
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={reset}
      >
        {hasLanes ? (
          <div className="kh-tickets-board is-lanes">
            <div className="kh-tickets-board-head">{layout.columns.map((c) => header(c.group))}</div>
            {layout.lanes.map((lane) => {
              const isCollapsed = collapsed.has(laneKey(lane.key));
              const count = layout.columns.reduce((n, c) => n + (c.byLane.get(lane.key)?.issues.length ?? 0), 0);
              return (
                <div key={lane.key} className="kh-tickets-lane">
                  <div className="kh-tickets-lane-header" onClick={() => onToggleGroup(laneKey(lane.key))}>
                    <span className={`kh-tickets-chevron${isCollapsed ? " is-collapsed" : ""}`}>
                      <Icon name="chevron-down" size={14} />
                    </span>
                    {lane.status ? <StatusIcon category={lane.status.category} color={lane.status.color} /> : null}
                    <span className="kh-tickets-group-name">{lane.label}</span>
                    <span className="kh-tickets-group-count">{count}</span>
                  </div>
                  {!isCollapsed && (
                    <div className="kh-tickets-lane-row">
                      {layout.columns.map((c) => cellView(c.byLane.get(lane.key)!, false))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="kh-tickets-board">
            {layout.columns.map((c) => (
              <div key={c.group.key} className="kh-tickets-col">
                {header(c.group)}
                {cellView(c.cell!, true)}
              </div>
            ))}
          </div>
        )}
        {/* Portalled to <body>: .kh-tickets-content is a container (layout containment), which would otherwise be the fixed-position origin. */}
        {createPortal(
          <DragOverlay>
            {active ? (
              <div className="kh-tickets-card is-overlay">
                <IssueCard issue={active} settings={settings} properties={display.properties} subCount={subCounts.get(active.id)} />
              </div>
            ) : null}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
    </div>
  );
}
