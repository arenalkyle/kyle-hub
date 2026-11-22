/** Heat of a note from agent reads (7/30/90-day windows) and recency of touch. Pure. */
export interface ReadAccess {
  t: string;
  path?: string;
}

export interface ReadCounts {
  d7: number;
  d30: number;
  d90: number;
  /** Epoch ms of the latest read. */
  last: number;
}

const DAY = 86_400_000;

const norm = (p: string): string => p.replace(/\\/g, "/").replace(/^\.\//, "");

/** Counts reads per vault-relative path; accesses older than 90 days or without a path are ignored. */
export function countReads(accesses: readonly ReadAccess[], now: number): Map<string, ReadCounts> {
  const out = new Map<string, ReadCounts>();
  for (const a of accesses) {
    if (!a.path) continue;
    const t = Date.parse(a.t);
    if (!Number.isFinite(t)) continue;
    const age = now - t;
    if (age > 90 * DAY) continue;
    const key = norm(a.path);
    const c = out.get(key) ?? { d7: 0, d30: 0, d90: 0, last: 0 };
    c.d90++;
    if (age <= 30 * DAY) c.d30++;
    if (age <= 7 * DAY) c.d7++;
    c.last = Math.max(c.last, t);
    out.set(key, c);
  }
  return out;
}

export interface Heat {
  /** 0 (cold) to 1 (hot): gold and larger. */
  heat: number;
  /** 0 (fresh) to 1 (untouched for 90+ days): dim. */
  dim: number;
}

/** `touched` is the file's modified time (epoch ms); a later read counts as a touch too. */
export function heatOf(c: ReadCounts | undefined, touched: number, now: number): Heat {
  const score = c ? c.d7 * 3 + c.d30 + c.d90 * 0.3 : 0;
  const heat = Math.min(1, Math.log1p(score) / Math.log1p(24));
  const last = Math.max(touched, c?.last ?? 0);
  const age = (now - last) / DAY;
  const dim = Math.max(0, Math.min(1, (age - 30) / 60));
  return { heat, dim };
}
