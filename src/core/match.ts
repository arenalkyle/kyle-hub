/** Case-insensitive match: every whitespace-separated token of `query` must appear in some field. */
export function matchesQuery(query: string, ...fields: ReadonlyArray<string | undefined>): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = fields.filter((f): f is string => !!f).map((f) => f.toLowerCase());
  return tokens.every((t) => hay.some((h) => h.includes(t)));
}

export function filterBy<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => ReadonlyArray<string | undefined>,
): T[] {
  return items.filter((i) => matchesQuery(query, ...fields(i)));
}

/** Fixed Linear-like palette for auto-assigned label colors. */
export const LABEL_PALETTE = [
  "#eb5757", "#f2994a", "#f2c94c", "#4cb782", "#26b5ce", "#4ea7fc",
  "#5e6ad2", "#8b5cf6", "#c46ee0", "#e5609f", "#95a2b3", "#6b9e78",
] as const;

/** Next palette color not yet used by `existing`; cycles when all are taken. */
export function nextLabelColor(existing: Record<string, string>): string {
  const used = new Set(Object.values(existing).map((c) => c.toLowerCase()));
  const free = LABEL_PALETTE.find((c) => !used.has(c));
  return free ?? LABEL_PALETTE[Object.keys(existing).length % LABEL_PALETTE.length]!;
}
