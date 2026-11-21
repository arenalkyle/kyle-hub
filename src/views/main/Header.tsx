import { useEffect, useRef, useState } from "react";
import type { DisplayState } from "../../core/display";
import { setFilterValues, type Filter, type FilterField } from "../../core/filters";
import { Icon } from "../components/icons";
import { DisplayPopover } from "./DisplayPopover";
import { FieldPicker, ValuePicker } from "./FilterMenu";

export interface HeaderProps {
  title: string;
  count: number;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onNewIssue: () => void;
  display: DisplayState;
  onDisplayChange: (next: DisplayState) => void;
  onDisplayReset: () => void;
  filters: readonly Filter[];
  onFiltersChange: (next: Filter[]) => void;
  /** Increment to open the filter menu (the `F` shortcut). */
  filterSignal?: number;
}

export function Header({ title, count, sidebarCollapsed, onToggleSidebar, onNewIssue, display, onDisplayChange, onDisplayReset, filters, onFiltersChange, filterSignal = 0 }: HeaderProps) {
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
      <button
        type="button"
        ref={filterBtn}
        className="kt-header-btn"
        onClick={(e) => (filterAnchor ? closeFilter() : setFilterAnchor(e.currentTarget))}
      >
        <Icon name="list-filter" size={14} /> Filter
        {filters.length > 0 && <span className="kt-filter-count">{filters.length}</span>}
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
