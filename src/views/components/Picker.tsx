import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { matchesQuery } from "../../core/match";

/** Where popovers are portalled; inside an Obsidian modal this is the modal container so the modal keeps them in its focus scope. */
export const PickerContainerContext = createContext<HTMLElement | null>(null);

export interface PickerProps<T> {
  anchor: HTMLElement | null;
  items: readonly T[];
  getKey: (item: T) => string;
  /** Strings the query is matched against; the first is also the item's name for "create" de-duplication. */
  getSearch: (item: T) => ReadonlyArray<string | undefined>;
  renderItem: (item: T) => ReactNode;
  selectedKeys?: readonly string[];
  multi?: boolean;
  onSelect: (item: T) => void;
  onClose: () => void;
  groupOf?: (item: T) => string;
  create?: { label: (query: string) => string; onCreate: (query: string) => void };
  placeholder?: string;
  footer?: ReactNode;
}

export function Picker<T>(p: PickerProps<T>) {
  const { anchor, items, multi, onClose } = p;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const placed = pos !== null;
  const container = useContext(PickerContainerContext) ?? document.body;

  const filtered = useMemo(
    () => items.filter((i) => matchesQuery(query, ...p.getSearch(i))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, query],
  );
  const q = query.trim();
  const canCreate =
    !!p.create && q !== "" && !filtered.some((i) => p.getSearch(i)[0]?.toLowerCase() === q.toLowerCase());
  const rowCount = filtered.length + (canCreate ? 1 : 0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!anchor || !el) return;
    const r = anchor.getBoundingClientRect();
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    const below = window.innerHeight - r.bottom;
    const top = below < h + 8 && r.top > below ? Math.max(8, r.top - h - 4) : r.bottom + 4;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    setPos({ left, top });
  }, [anchor, filtered.length, canCreate]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [anchor, onClose]);

  // The popover is rendered hidden until positioned; focus only once it is visible.
  useEffect(() => {
    if (placed) inputRef.current?.focus({ preventScroll: true });
  }, [placed]);
  // Safety net: if something other than a click elsewhere drops focus to nothing, take it back.
  const onInputBlur = () => {
    requestAnimationFrame(() => {
      const a = document.activeElement;
      if (ref.current && inputRef.current && (!a || a === document.body)) inputRef.current.focus({ preventScroll: true });
    });
  };
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(".kt-picker-row.is-active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (i: number) => {
    if (i < filtered.length) {
      p.onSelect(filtered[i]!);
      if (!multi) onClose();
    } else if (canCreate) {
      p.create!.onCreate(q);
      setQuery("");
      if (!multi) onClose();
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // Keep keys away from Obsidian's modal/hotkey scopes.
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (rowCount) setActive((a) => (a + 1) % rowCount);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (rowCount) setActive((a) => (a - 1 + rowCount) % rowCount);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (rowCount) choose(active);
    }
  };

  const selected = new Set(p.selectedKeys ?? []);
  let lastGroup: string | undefined;
  const rows: ReactNode[] = [];
  filtered.forEach((item, idx) => {
    const g = p.groupOf?.(item);
    if (g !== undefined && g !== lastGroup) {
      rows.push(<div key={`g:${g}`} className="kt-picker-group">{g}</div>);
      lastGroup = g;
    }
    const key = p.getKey(item);
    rows.push(
      <div
        key={key}
        className={`kt-picker-row${idx === active ? " is-active" : ""}${selected.has(key) ? " is-selected" : ""}`}
        onMouseMove={() => setActive(idx)}
        onClick={() => choose(idx)}
      >
        {multi && <span className={`kt-check${selected.has(key) ? " is-on" : ""}`} />}
        {p.renderItem(item)}
        {!multi && selected.has(key) && <span className="kt-picker-tick">{"✓"}</span>}
      </div>,
    );
  });
  if (canCreate) {
    const idx = filtered.length;
    rows.push(
      <div
        key="__create"
        className={`kt-picker-row kt-picker-create${idx === active ? " is-active" : ""}`}
        onMouseMove={() => setActive(idx)}
        onClick={() => choose(idx)}
      >
        {p.create!.label(q)}
      </div>,
    );
  }

  return createPortal(
    <div
      ref={ref}
      className="kt-picker"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
      onKeyDown={onKeyDown}
      // Portals bubble React events to ancestors (e.g. a root onMouseDown that refocuses itself); keep them out.
      onMouseDown={(e) => e.stopPropagation()}
      onFocus={(e) => e.stopPropagation()}
    >
      <input
        className="kt-picker-input"
        ref={inputRef}
        value={query}
        placeholder={p.placeholder ?? "Filter..."}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={onInputBlur}
      />
      <div className="kt-picker-list" ref={listRef}>
        {rows.length === 0 && <div className="kt-picker-empty">No results</div>}
        {rows}
      </div>
      {p.footer}
    </div>,
    container,
  );
}
