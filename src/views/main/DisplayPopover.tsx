import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  COMPLETED_LABELS, GROUP_BY_LABELS, GROUP_BY_OPTIONS, ORDER_BY_LABELS, ORDER_BY_OPTIONS, PROP_KEYS, PROP_LABELS,
  type CompletedMode, type DisplayState, type Layout,
} from "../../core/display";
import { Icon } from "../components/icons";
import { Picker } from "../components/Picker";

export interface DisplayPopoverProps {
  anchor: HTMLElement | null;
  display: DisplayState;
  onChange: (next: DisplayState) => void;
  onReset: () => void;
  onClose: () => void;
}

interface Option<T extends string> {
  value: T;
  label: string;
}

function Dropdown<T extends string>(props: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const current = props.options.find((o) => o.value === props.value);
  return (
    <div className="kt-disp-row">
      <span className="kt-disp-label">{props.label}</span>
      <button type="button" className="kt-disp-select" onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
        {current?.label ?? props.value}
        <Icon name="chevrons-up-down" size={12} />
      </button>
      {anchor && (
        <Picker<Option<T>>
          anchor={anchor}
          items={props.options}
          getKey={(o) => o.value}
          getSearch={(o) => [o.label]}
          selectedKeys={[props.value]}
          placeholder={`${props.label}...`}
          renderItem={(o) => <span className="kt-picker-label">{o.label}</span>}
          onSelect={(o) => props.onChange(o.value)}
          onClose={() => setAnchor(null)}
        />
      )}
    </div>
  );
}

function Switch(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="kt-disp-row">
      <span className="kt-disp-label">{props.label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        className={`kt-switch${props.checked ? " is-on" : ""}`}
        onClick={() => props.onChange(!props.checked)}
      >
        <span className="kt-switch-knob" />
      </button>
    </div>
  );
}

export function DisplayPopover({ anchor, display, onChange, onReset, onClose }: DisplayPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const set = (patch: Partial<DisplayState>) => onChange({ ...display, ...patch });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!anchor || !el) return;
    const r = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.right - el.offsetWidth, window.innerWidth - el.offsetWidth - 8));
    setPos({ left, top: r.bottom + 4 });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      if (ref.current?.contains(t) || anchor?.contains(t) || t.closest?.(".kt-picker")) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [anchor, onClose]);

  const groupOptions = GROUP_BY_OPTIONS.map((v) => ({ value: v, label: GROUP_BY_LABELS[v] }));
  const subOptions = groupOptions
    .filter((o) => o.value === "none" || o.value !== display.groupBy)
    .map((o) => (o.value === "none" ? { ...o, label: "No sub-grouping" } : o));

  return createPortal(
    <div
      ref={ref}
      className="kt-display-popover"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
    >
      <Dropdown<Layout>
        label="Layout"
        value={display.layout}
        options={[{ value: "list", label: "List" }, { value: "board", label: "Board" }]}
        onChange={(layout) => set({ layout })}
      />
      <Dropdown
        label="Grouping"
        value={display.groupBy}
        options={groupOptions}
        onChange={(groupBy) => set({ groupBy, subGroupBy: display.subGroupBy === groupBy ? "none" : display.subGroupBy })}
      />
      <Dropdown label="Sub-grouping" value={display.subGroupBy} options={subOptions} onChange={(subGroupBy) => set({ subGroupBy })} />
      <Dropdown
        label="Ordering"
        value={display.orderBy}
        options={ORDER_BY_OPTIONS.map((v) => ({ value: v, label: ORDER_BY_LABELS[v] }))}
        onChange={(orderBy) => set({ orderBy })}
      />
      <div className="kt-disp-sep" />
      <Switch label="Show sub-issues" checked={display.showSubIssues} onChange={(showSubIssues) => set({ showSubIssues })} />
      <Dropdown<CompletedMode>
        label="Completed issues"
        value={display.completed}
        options={(Object.keys(COMPLETED_LABELS) as CompletedMode[]).map((v) => ({ value: v, label: COMPLETED_LABELS[v] }))}
        onChange={(completed) => set({ completed })}
      />
      <Switch label="Show empty groups" checked={display.showEmptyGroups} onChange={(showEmptyGroups) => set({ showEmptyGroups })} />
      <div className="kt-disp-sep" />
      <div className="kt-disp-heading">Display properties</div>
      <div className="kt-disp-chips">
        {PROP_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            className={`kt-disp-chip${display.properties[k] ? " is-on" : ""}`}
            onClick={() => set({ properties: { ...display.properties, [k]: !display.properties[k] } })}
          >
            {PROP_LABELS[k]}
          </button>
        ))}
      </div>
      <div className="kt-disp-footer">
        <button type="button" className="kt-link-btn" onClick={onReset}>
          Reset
        </button>
      </div>
    </div>,
    document.body,
  );
}
