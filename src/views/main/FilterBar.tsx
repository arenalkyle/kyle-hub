import { useState } from "react";
import { FILTER_FIELD_LABELS, OP_LABELS, setFilterValues, type Filter } from "../../core/filters";
import { Icon } from "../components/icons";
import { ValuePicker, valueLabel } from "./FilterMenu";

export interface FilterBarProps {
  filters: readonly Filter[];
  onChange: (next: Filter[]) => void;
}

/** Chips for the active conditions, shown below the header. */
export function FilterBar({ filters, onChange }: FilterBarProps) {
  const [edit, setEdit] = useState<{ field: Filter["field"]; anchor: HTMLElement } | null>(null);
  if (filters.length === 0) return null;
  const toggleOp = (f: Filter) =>
    onChange(filters.map((x) => (x === f ? { ...x, op: x.op === "in" ? "notIn" : "in" } : x)));
  return (
    <div className="kt-filter-bar">
      {filters.map((f) => (
        <span key={f.field} className="kt-filter-chip">
          <span className="kt-filter-field">{FILTER_FIELD_LABELS[f.field]}</span>
          <button type="button" className="kt-filter-op" title="Toggle operator" onClick={() => toggleOp(f)}>
            {OP_LABELS[f.op]}
          </button>
          <button
            type="button"
            className="kt-filter-values"
            title="Change values"
            onClick={(e) => setEdit(edit?.field === f.field ? null : { field: f.field, anchor: e.currentTarget })}
          >
            {f.values.map((v) => valueLabel(f.field, v)).join(", ")}
          </button>
          <button type="button" className="kt-filter-x" title="Remove filter" onClick={() => onChange(filters.filter((x) => x !== f))}>
            <Icon name="x" size={12} />
          </button>
        </span>
      ))}
      <button type="button" className="kt-filter-clear" onClick={() => onChange([])}>
        Clear
      </button>
      {edit && (
        <ValuePicker
          anchor={edit.anchor}
          field={edit.field}
          value={filters.find((f) => f.field === edit.field)?.values ?? []}
          onChange={(vals) => onChange(setFilterValues(filters, edit.field, vals))}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}
