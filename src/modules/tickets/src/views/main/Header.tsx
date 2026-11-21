import { useEffect, useRef, useState } from "react";
import type { DisplayState } from "../../../../../core/domain/display";
import { setFilterValues, type Filter, type FilterField } from "../../../../../core/domain/filters";
import type { Group } from "../../../../../core/domain/query";
import { Icon } from "../components/icons";
import { DisplayPopover } from "./DisplayPopover";
import { FieldPicker, ValuePicker } from "./FilterMenu";

export interface HeaderProps {
  title: string;
  count: number;
  sidebarCollapsed: boolean;
  /** Omit when there is no sidebar to toggle. */
  onToggleSidebar?: () => void;
  onNewIssue: () => void;
  display: DisplayState;
  onDisplayChange: (next: DisplayState) => void;
  onDisplayReset: () => void;
  filters: readonly Filter[];
  onFiltersChange: (next: Filter[]) => void;
  /** Increment to open the filter menu (the `F` shortcut). */
  filterSignal?: number;
  /** All current groups, for the Hidden columns list. */
  groups?: readonly Group[];
}

export function Header({ title, count, sidebarCollapsed, onToggleSidebar, onNewIssue, display, onDisplayChange, onDisplayReset, filters, onFiltersChange, filterSignal = 0, groups = [] }: HeaderProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
  const [filterField, setFilterField] = useState<FilterField | null>(null);
  const filterBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (filterSignal > 0 && filterBtn.current) {
      setFilterField(null);
      setFilterAnchor(filterBtn.current);
    }
  }, [filterSignal]);
  const closeFilter = () => {
    setFilterAnchor(null);
    setFilterField(null);
  };
  return (
    <div className="kh-tickets-header">
      {onToggleSidebar && (
        <button
          type="button"
          className="kh-tickets-icon-btn"
          title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          onClick={onToggleSidebar}
        >
          <Icon name="panel-left" size={16} />
        </button>
      )}
      <h2 className="kh-tickets-header-title">{title}</h2>
      <span className="kh-tickets-header-count">{count}</span>
      <div className="kh-tickets-header-spacer" />
      <div className="kh-tickets-toggle">
        <button type="button" className={display.layout === "list" ? "is-active" : ""} onClick={() => onDisplayChange({ ...display, layout: "list" })}>
          List
        </button>
        <button type="button" className={display.layout === "board" ? "is-active" : ""} onClick={() => onDisplayChange({ ...display, layout: "board" })}>
          Board
        </button>
      </div>
      <button
        type="button"
        ref={filterBtn}
        className="kh-tickets-header-btn"
        onClick={(e) => (filterAnchor ? closeFilter() : setFilterAnchor(e.currentTarget))}
      >
        <Icon name="list-filter" size={14} /> Filter
        {filters.length > 0 && <span className="kh-tickets-filter-count">{filters.length}</span>}
      </button>
      {filterAnchor && !filterField && <FieldPicker anchor={filterAnchor} onSelect={setFilterField} onClose={closeFilter} />}
      {filterAnchor && filterField && (
        <ValuePicker
          anchor={filterAnchor}
          field={filterField}
          value={filters.find((f) => f.field === filterField)?.values ?? []}
          onChange={(vals) => onFiltersChange(setFilterValues(filters, filterField, vals))}
          onClose={closeFilter}
        />
      )}
      <button type="button" className="kh-tickets-header-btn" onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
        <Icon name="sliders-horizontal" size={14} /> Display
      </button>
      {anchor && (
        <DisplayPopover
          anchor={anchor}
          display={display}
          groups={groups}
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
