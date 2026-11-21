export type PrState = "open" | "draft" | "merged" | "closed";

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
  /** Canonical `https://github.com/owner/repo/pull/N`. */
  url: string;
}

export interface PrInfo extends PrRef {
  title: string;
  state: PrState;
  headRefName?: string;
}

const PR_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)(?:[/?#].*)?$/;

/** Parses a github.com PR URL (suffixes like `/files` are accepted); other hosts yield `null`. */
export function parsePrUrl(input: string): PrRef | null {
  const m = PR_URL.exec(input.trim());
  if (!m) return null;
  const [, owner, repo, n] = m as unknown as [string, string, string, string];
  return { owner, repo, number: Number(n), url: `https://github.com/${owner}/${repo}/pull/${n}` };
}

export function prLabel(ref: Pick<PrRef, "owner" | "repo" | "number">): string {
  return `${ref.owner}/${ref.repo}#${ref.number}`;
}

/** Label for a stored URL; unparseable URLs are shown as-is. */
export function prLabelOfUrl(url: string): string {
  const r = parsePrUrl(url);
  return r ? prLabel(r) : url;
}

const RANK: Record<PrState, number> = { merged: 4, open: 3, draft: 2, closed: 1 };

/** Best state of a set: merged > open > draft > closed; `undefined` when empty. */
export function bestState(prs: readonly { state: PrState }[]): PrState | undefined {
  let best: PrState | undefined;
  for (const p of prs) if (best === undefined || RANK[p.state] > RANK[best]) best = p.state;
  return best;
}

/** Maps `gh pr view --json` state/isDraft to a `PrState`. */
export function toPrState(state: string, isDraft: boolean): PrState {
  const s = state.toUpperCase();
  if (s === "MERGED") return "merged";
  if (s === "CLOSED") return "closed";
  return isDraft ? "draft" : "open";
}

export interface PrCacheEntry {
  info: PrInfo;
  fetchedAt: number;
}

/** True when the cached entry should be refetched (missing or older than `maxAgeMs`). */
export function isStale(entry: PrCacheEntry | undefined, now: number, maxAgeMs: number): boolean {
  return !entry || now - entry.fetchedAt >= maxAgeMs;
}
