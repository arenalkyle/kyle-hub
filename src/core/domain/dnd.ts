import type { GroupBy } from "./display";
import type { IssuePatch } from "./issueFile";
import { OTHER_GROUP_KEY } from "./query";
import type { Issue, Priority } from "./types";

/** Where a card sits on the Board: its column's group key and, with sub-grouping, the swimlane's own (un-prefixed) key. */
export interface DropKeys {
  group: string;
  sub?: string;
}

const PRIORITIES: readonly string[] = ["none", "urgent", "high", "medium", "low"];

/** Parsed group key: the target value (`null` = the "No ..." group). */
type Target = { ok: true; value: string | null } | { ok: false };

function parseKey(field: GroupBy, key: string | undefined): Target {
  if (key === undefined || key === OTHER_GROUP_KEY) return { ok: false };
  if (key === `none:${field}`) return { ok: true, value: null };
  const prefix = `${field}:`;
  if (!key.startsWith(prefix)) return { ok: false };
  const value = key.slice(prefix.length);
  if (value === "") return { ok: false };
  if (field === "priority" && !PRIORITIES.includes(value)) return { ok: false };
  return { ok: true, value };
}

/** Adds one dimension's change to `patch`; returns false when the drop is impossible. */
function addDimension(
  field: GroupBy,
  fromKey: string | undefined,
  toKey: string | undefined,
  issue: Issue,
  patch: IssuePatch,
): boolean {
  if (field === "none") return true;
  if (fromKey === toKey) return true;
  const to = parseKey(field, toKey);
  if (!to.ok) return false;
  switch (field) {
    case "status":
      if (to.value === null) return false;
      patch.status = to.value;
      return true;
    case "priority":
      patch.priority = (to.value ?? "none") as Priority;
      return true;
    case "project":
      patch.project = to.value;
      return true;
    case "assignee":
      patch.assignee = to.value;
      return true;
    case "milestone":
      patch.milestone = to.value;
      return true;
    case "label": {
      const from = parseKey("label", fromKey);
      const fromLabel = from.ok ? from.value : null;
      const tags = issue.tags.filter((t) => t !== fromLabel);
      if (to.value !== null && !tags.includes(to.value)) tags.push(to.value);
      patch.tags = tags;
      return true;
    }
  }
}

/**
 * Field changes for dropping `issue` from one Board cell onto another.
 * Returns `{}` when nothing changes (same cell) and `null` for impossible drops
 * (the "Other" status group, or a key that doesn't belong to the grouped field).
 */
export function dropToPatch(
  groupBy: GroupBy,
  subGroupBy: GroupBy,
  fromKeys: DropKeys,
  toKeys: DropKeys,
  issue: Issue,
): IssuePatch | null {
  const patch: IssuePatch = {};
  if (!addDimension(groupBy, fromKeys.group, toKeys.group, issue, patch)) return null;
  const sub = subGroupBy === groupBy ? "none" : subGroupBy;
  if (!addDimension(sub, fromKeys.sub, toKeys.sub, issue, patch)) return null;
  return patch;
}

export const SORT_STEP = 1000;
const MIN_GAP = 1e-6;

/** Midpoint between neighbours; open ends step by `SORT_STEP`. Callers rebalance when `needsRebalance`. */
export function sortOrderBetween(prev?: number, next?: number): number {
  if (prev === undefined && next === undefined) return SORT_STEP;
  if (prev === undefined) return next! - SORT_STEP;
  if (next === undefined) return prev + SORT_STEP;
  return (prev + next) / 2;
}

/** True when there is no room left between `prev` and `next` for a distinct midpoint. */
export function needsRebalance(prev?: number, next?: number): boolean {
  return prev !== undefined && next !== undefined && next - prev < MIN_GAP;
}

/**
 * New `sortOrder` values after moving `movedId` inside `list` (already in its new order).
 * Normally only the moved item changes; if the previous neighbour has no order or the gap
 * is exhausted, the whole column is renumbered.
 */
export function planReorder(
  list: readonly { id: string; sortOrder?: number }[],
  movedId: string,
): Record<string, number> {
  const idx = list.findIndex((i) => i.id === movedId);
  if (idx < 0) return {};
  const prev = idx > 0 ? list[idx - 1]!.sortOrder : undefined;
  const next = idx < list.length - 1 ? list[idx + 1]!.sortOrder : undefined;
  const prevMissing = idx > 0 && prev === undefined;
  if (prevMissing || needsRebalance(prev, next)) {
    const out: Record<string, number> = {};
    list.forEach((i, n) => {
      const v = (n + 1) * SORT_STEP;
      if (i.sortOrder !== v || i.id === movedId) out[i.id] = v;
    });
    return out;
  }
  return { [movedId]: sortOrderBetween(prev, next) };
}
