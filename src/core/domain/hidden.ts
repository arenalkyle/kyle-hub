import type { GroupBy } from "./display";

/** Hidden group keys per grouping field (`DisplayState.hiddenGroups`). */
export type HiddenGroups = Record<string, string[]>;

export function hiddenFor(hidden: HiddenGroups, groupBy: GroupBy): readonly string[] {
  return groupBy === "none" ? [] : (hidden[groupBy] ?? []);
}

/** Returns a new map with `key` hidden or shown under `groupBy`; empty lists are dropped. */
export function toggleHidden(hidden: HiddenGroups, groupBy: GroupBy, key: string, hide: boolean): HiddenGroups {
  if (groupBy === "none") return hidden;
  const rest = (hidden[groupBy] ?? []).filter((k) => k !== key);
  const list = hide ? [...rest, key] : rest;
  const others = { ...hidden };
  delete others[groupBy];
  return list.length ? { ...others, [groupBy]: list } : others;
}

export function visibleGroups<T extends { key: string }>(groups: readonly T[], hiddenKeys: readonly string[]): T[] {
  if (hiddenKeys.length === 0) return [...groups];
  const set = new Set(hiddenKeys);
  return groups.filter((g) => !set.has(g.key));
}

/** Sanitise persisted (untrusted) hidden-groups state. */
export function sanitizeHidden(raw: unknown): HiddenGroups {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: HiddenGroups = {};
  for (const [field, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(v)) continue;
    const keys = v.filter((k): k is string => typeof k === "string");
    if (keys.length) out[field] = [...new Set(keys)];
  }
  return out;
}
