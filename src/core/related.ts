import type { Issue } from "./types";

type Rel = Pick<Issue, "id" | "related">;

/** Symmetric related list: IDs `issue` lists plus IDs of issues that list it; deduped, no self, no missing IDs. */
export function relatedIds(issue: Rel, all: readonly Rel[]): string[] {
  const known = new Set(all.map((i) => i.id));
  const out: string[] = [];
  const add = (id: string): void => {
    if (id !== issue.id && known.has(id) && !out.includes(id)) out.push(id);
  };
  issue.related.forEach(add);
  for (const o of all) if (o.related.includes(issue.id)) add(o.id);
  return out;
}

/** New `related` list for `issue` after adding `other`, or `null` when nothing changes (already related either way, or self). */
export function addRelatedList(issue: Rel, other: string, all: readonly Rel[]): string[] | null {
  if (other === issue.id || relatedIds(issue, all).includes(other)) return null;
  return [...issue.related, other];
}

/** Per-issue new `related` lists that remove the relation between `a` and `b` (only files that hold it). */
export function removeRelatedLists(a: Rel, b: Rel): { id: string; related: string[] }[] {
  const out: { id: string; related: string[] }[] = [];
  if (a.related.includes(b.id)) out.push({ id: a.id, related: a.related.filter((x) => x !== b.id) });
  if (b.related.includes(a.id)) out.push({ id: b.id, related: b.related.filter((x) => x !== a.id) });
  return out;
}
