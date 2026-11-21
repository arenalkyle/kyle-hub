import { parsePrUrl } from "./pr";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Issue IDs mentioned in `text`: `PREFIX` + `-`/`_` + digits, case-insensitive, not preceded by
 * a letter/digit and not followed by a digit (so `TIX-1` never matches `TIX-12`).
 * Normalised to `PREFIX-N` (uppercase prefix, no leading zeros), de-duplicated in order of appearance.
 */
export function findIssueIds(text: string, prefix: string): string[] {
  const p = prefix.trim();
  if (!p) return [];
  const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(p)}[-_](\\d+)(?![0-9])`, "gi");
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const id = `${p.toUpperCase()}-${Number(m[1])}`;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export interface CandidatePr {
  url: string;
  title: string;
  headRefName?: string;
}

export interface LinkTarget {
  id: string;
  pullRequests: readonly string[];
}

export interface PlannedLink {
  issueId: string;
  url: string;
}

const canon = (u: string): string => parsePrUrl(u)?.url ?? u;

/**
 * Which PR should be linked to which issue: IDs found in title or branch, skipping unknown issues,
 * PRs already linked, and PRs the user unlinked from that issue. Order and uniqueness are stable.
 */
export function planLinks(
  prs: readonly CandidatePr[],
  issues: readonly LinkTarget[],
  unlinked: Readonly<Record<string, readonly string[]>>,
  prefix: string,
): PlannedLink[] {
  const byId = new Map(issues.map((i) => [i.id.toUpperCase(), i]));
  const out: PlannedLink[] = [];
  const seen = new Set<string>();
  for (const pr of prs) {
    const url = canon(pr.url);
    for (const id of findIssueIds(`${pr.title}\n${pr.headRefName ?? ""}`, prefix)) {
      const issue = byId.get(id);
      if (!issue) continue;
      if (issue.pullRequests.some((u) => canon(u) === url)) continue;
      if ((unlinked[issue.id] ?? []).some((u) => canon(u) === url)) continue;
      const key = `${issue.id}|${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ issueId: issue.id, url });
    }
  }
  return out;
}

/** Returns `unlinked` with `url` added for `issueId` (unchanged when already present). */
export function markUnlinked(unlinked: Record<string, string[]>, issueId: string, url: string): Record<string, string[]> {
  const u = canon(url);
  const cur = unlinked[issueId] ?? [];
  return cur.includes(u) ? unlinked : { ...unlinked, [issueId]: [...cur, u] };
}

/** Returns `unlinked` with `url` removed for `issueId` (a manual re-link lifts the block). */
export function clearUnlinked(unlinked: Record<string, string[]>, issueId: string, url: string): Record<string, string[]> {
  const u = canon(url);
  const cur = unlinked[issueId];
  if (!cur?.includes(u)) return unlinked;
  const rest = { ...unlinked };
  const next = cur.filter((x) => x !== u);
  if (next.length) rest[issueId] = next;
  else delete rest[issueId];
  return rest;
}
