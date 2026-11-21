import type { UsageEvent } from "../logs/types";

/** Rolling windows (ADR-0012): a 5 h session block and a 7 d week. */
export const SESSION_MS = 5 * 3_600_000;
export const WEEK_MS = 7 * 24 * 3_600_000;
const DAY_MS = 86_400_000;

export interface PlanCap {
  /** Tokens per 5 h session block. */
  session: number;
  /** Tokens per rolling week. */
  week: number;
}

/** Caps per plan key (lowercase), plus `default`. Placeholders: calibrate against `/usage` (usage.caps.<plan>). */
export type UsageCaps = Readonly<Record<string, PlanCap>>;

export const DEFAULT_CAPS: UsageCaps = {
  default: { session: 1_000_000, week: 10_000_000 },
  pro: { session: 500_000, week: 5_000_000 },
  max5x: { session: 2_500_000, week: 25_000_000 },
  max20x: { session: 10_000_000, week: 100_000_000 },
};

export interface Budget {
  /** Optional USD budget for the local day / month. */
  dayUsd?: number;
  monthUsd?: number;
}

export interface UsageAccount {
  id: string;
  label: string;
  kind: "subscription" | "enterprise";
  plan: string;
}

/** Local-time offset in minutes behind UTC at an instant (what `Date#getTimezoneOffset` returns); injectable so DST is testable. */
export type OffsetFn = (ms: number) => number;
export const localOffset: OffsetFn = (ms) => new Date(ms).getTimezoneOffset();

export interface WindowUsage {
  tokens: number;
  messages: number;
  costUsd: number;
  /** ISO start of the window; absent when no activity. */
  startsAt?: string;
  /** ISO time the window resets (session: block end; week: when the oldest message rolls off). */
  resetsAt?: string;
  /** Session only: false when the last block already ended (usage 0 until the next message). */
  active?: boolean;
}

export interface SubscriptionView {
  /** Percent of the user-calibrated cap, uncapped (may exceed 100). */
  sessionPercent: number;
  weekPercent: number;
  cap: PlanCap;
}

export interface EnterpriseView {
  todayUsd: number;
  monthUsd: number;
  budget: Budget;
  /** Percent of the monthly / daily budget when one is set. */
  monthBudgetPercent?: number;
  dayBudgetPercent?: number;
}

export interface AccountUsage {
  accountId: string;
  label: string;
  kind: UsageAccount["kind"];
  plan: string;
  session: WindowUsage;
  week: WindowUsage;
  /** Present for subscription accounts. Enterprise accounts have `enterprise` instead and never a percent. */
  subscription?: SubscriptionView;
  enterprise?: EnterpriseView;
  /** `estimate` (derived locally; other machines and apps are not seen) or `official` (best-effort undocumented reading). */
  source: "estimate" | "official";
}

const sum = (events: readonly UsageEvent[]): { tokens: number; messages: number; costUsd: number } => ({
  tokens: events.reduce((n, e) => n + e.tokens, 0),
  messages: events.length,
  costUsd: Math.round(events.reduce((n, e) => n + e.costUsd, 0) * 1e8) / 1e8,
});

const iso = (ms: number): string => new Date(ms).toISOString();

/** The active session block at `now`: blocks start at the first message after the previous block ended and last 5 h. */
export function sessionWindow(events: readonly UsageEvent[], now: number): WindowUsage {
  const sorted = events
    .map((e) => ({ e, ms: Date.parse(e.t) }))
    .filter((x) => Number.isFinite(x.ms) && x.ms <= now)
    .sort((a, b) => a.ms - b.ms);
  let start = -Infinity;
  let block: UsageEvent[] = [];
  for (const { e, ms } of sorted) {
    if (ms >= start + SESSION_MS) {
      start = ms;
      block = [];
    }
    block.push(e);
  }
  if (block.length === 0) return { tokens: 0, messages: 0, costUsd: 0, active: false };
  if (now >= start + SESSION_MS) return { tokens: 0, messages: 0, costUsd: 0, active: false, startsAt: iso(start), resetsAt: iso(start + SESSION_MS) };
  return { ...sum(block), startsAt: iso(start), resetsAt: iso(start + SESSION_MS), active: true };
}

/** Rolling 7 days ending at `now`; resets when the oldest counted message rolls off. */
export function weekWindow(events: readonly UsageEvent[], now: number): WindowUsage {
  const inWeek = events.filter((e) => {
    const ms = Date.parse(e.t);
    return Number.isFinite(ms) && ms > now - WEEK_MS && ms <= now;
  });
  if (inWeek.length === 0) return { tokens: 0, messages: 0, costUsd: 0 };
  const oldest = Math.min(...inWeek.map((e) => Date.parse(e.t)));
  return { ...sum(inWeek), startsAt: iso(oldest), resetsAt: iso(oldest + WEEK_MS) };
}

/** Epoch ms of local midnight for the day containing `ms` (DST-aware through `off`). */
export function startOfLocalDay(ms: number, off: OffsetFn = localOffset): number {
  const local = ms - off(ms) * 60_000;
  const dayLocal = Math.floor(local / DAY_MS) * DAY_MS;
  const guess = dayLocal + off(ms) * 60_000;
  return dayLocal + off(guess) * 60_000;
}

/** Epoch ms of local midnight on the 1st of the month containing `ms`. */
export function startOfLocalMonth(ms: number, off: OffsetFn = localOffset): number {
  const d = new Date(ms - off(ms) * 60_000);
  const monthLocal = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const guess = monthLocal + off(ms) * 60_000;
  return monthLocal + off(guess) * 60_000;
}

export function capFor(caps: UsageCaps, plan: string): PlanCap {
  return caps[plan.trim().toLowerCase()] ?? caps.default ?? DEFAULT_CAPS.default!;
}

const pct = (used: number, cap: number): number => (cap > 0 ? Math.round((used / cap) * 1000) / 10 : 0);

export interface ComputeOptions {
  caps?: UsageCaps;
  budget?: Budget;
  offset?: OffsetFn;
}

/** Pure: usage of one account from its derived usage events. */
export function computeAccountUsage(account: UsageAccount, events: readonly UsageEvent[], now: number, opts: ComputeOptions = {}): AccountUsage {
  const session = sessionWindow(events, now);
  const week = weekWindow(events, now);
  const out: AccountUsage = { accountId: account.id, label: account.label, kind: account.kind, plan: account.plan, session, week, source: "estimate" };
  if (account.kind === "enterprise") {
    const off = opts.offset ?? localOffset;
    const dayStart = startOfLocalDay(now, off);
    const monthStart = startOfLocalMonth(now, off);
    const within = (from: number): number =>
      sum(events.filter((e) => { const ms = Date.parse(e.t); return ms >= from && ms <= now; })).costUsd;
    const todayUsd = within(dayStart);
    const monthUsd = within(monthStart);
    const budget = opts.budget ?? {};
    const view: EnterpriseView = { todayUsd, monthUsd, budget };
    if (budget.monthUsd && budget.monthUsd > 0) view.monthBudgetPercent = pct(monthUsd, budget.monthUsd);
    if (budget.dayUsd && budget.dayUsd > 0) view.dayBudgetPercent = pct(todayUsd, budget.dayUsd);
    out.enterprise = view;
  } else {
    const cap = capFor(opts.caps ?? DEFAULT_CAPS, account.plan);
    out.subscription = { sessionPercent: pct(session.tokens, cap.session), weekPercent: pct(week.tokens, cap.week), cap };
  }
  return out;
}

/** "2h 05m", "3d 4h", "now": time until `resetsAt`. */
export function formatCountdown(resetsAt: string | undefined, now: number): string {
  if (!resetsAt) return "";
  const ms = Date.parse(resetsAt) - now;
  if (!(ms > 0)) return "now";
  const m = Math.ceil(ms / 60_000);
  if (m >= 48 * 60) return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

const fmtTok = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const usd = (n: number): string => `$${n.toFixed(2)}`;

/** One-line text for the chip and the picker. Subscription: percent. Enterprise: dollars, never a percent of a plan cap. */
export function usageLine(u: AccountUsage, now: number): string {
  const tag = u.source === "official" ? "official" : "est.";
  if (u.enterprise) {
    const e = u.enterprise;
    const budget = e.budget.monthUsd ? ` / ${usd(e.budget.monthUsd)}` : "";
    return `${u.label}: ${usd(e.todayUsd)} today · ${usd(e.monthUsd)} month${budget} (${tag})`;
  }
  const s = u.subscription;
  const reset = u.session.active ? ` (resets ${formatCountdown(u.session.resetsAt, now)})` : "";
  return `${u.label}: session ${s?.sessionPercent ?? 0}%${reset} · week ${s?.weekPercent ?? 0}% · ${fmtTok(u.week.tokens)} tok (${tag})`;
}

export type UsageWindowName = "session" | "week" | "month" | "day";

export interface ThresholdHit {
  accountId: string;
  window: UsageWindowName;
  percent: number;
  /** Identifies the window instance so a hit fires once per window. */
  windowStart: string;
}

/** Windows at or over `warnPercent`. Enterprise accounts only warn against their budgets. */
export function thresholdHits(u: AccountUsage, warnPercent: number, now: number, off: OffsetFn = localOffset): ThresholdHit[] {
  const hits: ThresholdHit[] = [];
  const add = (window: UsageWindowName, percent: number | undefined, windowStart: string | undefined): void => {
    if (percent !== undefined && percent >= warnPercent && windowStart) hits.push({ accountId: u.accountId, window, percent, windowStart });
  };
  if (u.subscription) {
    if (u.session.active) add("session", u.subscription.sessionPercent, u.session.startsAt);
    add("week", u.subscription.weekPercent, u.week.startsAt);
  } else if (u.enterprise) {
    add("month", u.enterprise.monthBudgetPercent, iso(startOfLocalMonth(now, off)));
    add("day", u.enterprise.dayBudgetPercent, iso(startOfLocalDay(now, off)));
  }
  return hits;
}
