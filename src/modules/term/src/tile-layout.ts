/** Pure tiling model: up to 4 columns, each holding 1-2 stacked session ids (max 8 visible). */
export type Layout = string[][];
export type Zone = "left" | "right" | "above" | "below" | "replace";
export type ExpandLevel = 0 | 1 | 2;

export const MAX_COLS = 4;
export const MAX_ROWS = 2;

export function ids(layout: Layout): string[] {
  return layout.flat();
}

export function remove(layout: Layout, id: string): Layout {
  return layout.map((c) => c.filter((x) => x !== id)).filter((c) => c.length > 0);
}

/** Downgrades a zone to "replace" when its split would exceed the column/row limits. */
export function resolveZone(layout: Layout, dragged: string, target: string, zone: Zone): Zone {
  const l = remove(layout, dragged);
  const col = l.find((c) => c.includes(target));
  if (!col) return "replace";
  if ((zone === "left" || zone === "right") && l.length >= MAX_COLS) return "replace";
  if ((zone === "above" || zone === "below") && col.length >= MAX_ROWS) return "replace";
  return zone;
}

/** The layout after dropping `dragged` on `target`; null when nothing changes. */
export function applyDrop(layout: Layout, dragged: string, target: string, zone: Zone): Layout | null {
  if (dragged === target) return null;
  const z = resolveZone(layout, dragged, target, zone);
  if (z === "replace") {
    const had = ids(layout).includes(dragged);
    return layout.map((c) => c.map((id) => (id === target ? dragged : had && id === dragged ? target : id)));
  }
  const l = remove(layout, dragged).map((c) => [...c]);
  const ci = l.findIndex((c) => c.includes(target));
  if (ci < 0) return null;
  const col = l[ci]!;
  const ri = col.indexOf(target);
  if (z === "left") l.splice(ci, 0, [dragged]);
  else if (z === "right") l.splice(ci + 1, 0, [dragged]);
  else if (z === "above") col.splice(ri, 0, dragged);
  else col.splice(ri + 1, 0, dragged);
  return l;
}

/** Double-click / expand button cycle: normal -> fill its column (if stacked) -> fill everything -> normal. */
export function nextExpand(layout: Layout, id: string, level: ExpandLevel): ExpandLevel {
  const col = layout.find((c) => c.includes(id));
  if (!col) return 0;
  const steps: (1 | 2)[] = [];
  if (col.length > 1) steps.push(1);
  if (layout.length > 1) steps.push(2);
  if (level === 0) return steps[0] ?? 0;
  const i = steps.indexOf(level);
  return steps[i + 1] ?? 0;
}
