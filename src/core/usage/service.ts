import type { Account } from "../accounts";
import {
  computeAccountUsage,
  DEFAULT_CAPS,
  SESSION_MS,
  startOfLocalMonth,
  thresholdHits,
  usageLine,
  WEEK_MS,
  type AccountUsage,
  type Budget,
  type OffsetFn,
  type ThresholdHit,
  type UsageCaps,
} from "../domain/usage";
import type { LogService, UsageEvent } from "../logs/types";
import { localOffset } from "../domain/usage";

/** `modules.usage` settings: calibration caps, enterprise budgets, the opt-in official reading and the warning level. */
export interface UsageSettings {
  caps: UsageCaps;
  /** Per account id. */
  budgets: Record<string, Budget>;
  /** Opt-in (default off). Best-effort and undocumented: asks the account's own `claude` for its reading. */
  officialReading: boolean;
  warnPercent: number;
}

export const DEFAULT_USAGE_SETTINGS: UsageSettings = { caps: { ...DEFAULT_CAPS }, budgets: {}, officialReading: false, warnPercent: 80 };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const posNum = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);

/** Reads `modules.usage`; bad entries are ignored and defaults fill the rest. Caps merge over the placeholder defaults per plan. */
export function usageSettingsOf(raw: unknown): UsageSettings {
  const r = isObj(raw) ? raw : {};
  const caps: Record<string, { session: number; week: number }> = { ...DEFAULT_CAPS };
  if (isObj(r.caps)) {
    for (const [plan, c] of Object.entries(r.caps)) {
      if (!isObj(c)) continue;
      const base = caps[plan.toLowerCase()] ?? caps.default!;
      caps[plan.toLowerCase()] = { session: posNum(c.session) ?? base.session, week: posNum(c.week) ?? base.week };
    }
  }
  const budgets: Record<string, Budget> = {};
  if (isObj(r.budgets)) {
    for (const [id, b] of Object.entries(r.budgets)) {
      if (!isObj(b)) continue;
      const entry: Budget = {};
      const d = posNum(b.dayUsd);
      const m = posNum(b.monthUsd);
      if (d) entry.dayUsd = d;
      if (m) entry.monthUsd = m;
      budgets[id] = entry;
    }
  }
  return { caps, budgets, officialReading: r.officialReading === true, warnPercent: posNum(r.warnPercent) ?? 80 };
}

export interface OfficialReading {
  sessionPercent: number;
  weekPercent: number;
}

/** Fetches an account's exact reading. Only ever called when `officialReading` is on. May reject or return undefined (falls back to the estimate). */
export type OfficialReader = (account: Account) => Promise<OfficialReading | undefined>;

export interface UsageServiceDeps {
  logs: () => Pick<LogService, "usageEvents"> | undefined;
  accounts: () => Account[];
  settings: () => UsageSettings;
  now?: () => number;
  offset?: OffsetFn;
  /** Used only when `settings().officialReading` is on. */
  official?: OfficialReader;
  /** Called once per window instance that crossed the warning level. */
  onThreshold?: (hit: ThresholdHit) => void;
  /** Window instances already announced; mutated in place. Persist via `persistFired`. */
  fired?: Set<string>;
  persistFired?: (keys: string[]) => void;
  /** Snapshot cache lifetime in ms (default 15000; 0 disables). */
  cacheMs?: number;
}

/** The usage tracker (ADR-0012): per-account session and week estimates from derived records. Reads only through `logs`. */
export class UsageTracker {
  private readonly listeners = new Set<() => void>();
  private readonly fired: Set<string>;

  constructor(private readonly d: UsageServiceDeps) {
    this.fired = d.fired ?? new Set();
  }

  private now(): number {
    return this.d.now ? this.d.now() : Date.now();
  }

  private cache?: { at: number; value: AccountUsage[] };

  async snapshot(): Promise<AccountUsage[]> {
    const ttl = this.d.cacheMs ?? 15_000;
    const at = this.now();
    if (this.cache && ttl > 0 && at - this.cache.at < ttl && at >= this.cache.at) return this.cache.value;
    const value = await this.compute();
    this.cache = { at, value };
    return value;
  }

  /** Drops the cached snapshot (after an ingest). */
  invalidate(): void {
    this.cache = undefined;
  }

  private async compute(): Promise<AccountUsage[]> {
    const accounts = this.d.accounts();
    if (accounts.length === 0) return [];
    const now = this.now();
    const s = this.d.settings();
    const off = this.d.offset ?? localOffset;
    const since = new Date(Math.min(now - WEEK_MS - SESSION_MS, startOfLocalMonth(now, off))).toISOString();
    const logs = this.d.logs();
    let events: UsageEvent[] = [];
    try {
      events = logs ? await logs.usageEvents(since) : [];
    } catch {
      events = [];
    }
    const out: AccountUsage[] = [];
    for (const a of accounts) {
      const mine = events.filter((e) => e.accountId === a.id);
      let u = computeAccountUsage({ id: a.id, label: a.label, kind: a.kind, plan: a.plan }, mine, now, { caps: s.caps, budget: s.budgets[a.id], offset: off });
      if (s.officialReading && this.d.official && u.subscription) u = await this.withOfficial(a, u);
      out.push(u);
    }
    return out;
  }

  private async withOfficial(a: Account, u: AccountUsage): Promise<AccountUsage> {
    try {
      const r = await this.d.official!(a);
      if (r && u.subscription) return { ...u, source: "official", subscription: { ...u.subscription, sessionPercent: r.sessionPercent, weekPercent: r.weekPercent } };
    } catch {
      /* fall back to the estimate */
    }
    return u;
  }

  /** One text line per account id (chip and launch picker). */
  async lines(): Promise<Record<string, string>> {
    const now = this.now();
    return Object.fromEntries((await this.snapshot()).map((u) => [u.accountId, usageLine(u, now)]));
  }

  /** Emits `onThreshold` once per window instance at or over the warning level. Never switches accounts. */
  async check(): Promise<ThresholdHit[]> {
    const now = this.now();
    const warn = this.d.settings().warnPercent;
    const fresh: ThresholdHit[] = [];
    for (const u of await this.snapshot()) {
      for (const hit of thresholdHits(u, warn, now, this.d.offset)) {
        const key = `${hit.accountId}|${hit.window}|${hit.windowStart}`;
        if (this.fired.has(key)) continue;
        this.fired.add(key);
        fresh.push(hit);
      }
    }
    if (fresh.length > 0) {
      this.d.persistFired?.([...this.fired].slice(-200));
      for (const hit of fresh) this.d.onThreshold?.(hit);
    }
    for (const l of [...this.listeners]) l();
    return fresh;
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
