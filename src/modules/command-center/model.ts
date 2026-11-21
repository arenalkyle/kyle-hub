import type { AttentionInfo, AttentionService, BrainService, LogService, RetroService, RetroStatus, SessionInfo, SessionService, TicketService, UsageService } from "../../core";
import { formatCountdown, type AccountUsage } from "../../core/domain/usage";
import type { BrainHealth } from "../../core/brain/service";
import type { Issue, StatusDef } from "../../core/domain/types";
import type { RunIndexEntry, SpendDay } from "../../core/logs/types";
import { triageIssues } from "../../core/domain/triage";

/** Read-only slice of the services. Write methods are absent from these types, so the view cannot call them. */
export interface CommandCenterReader {
  tickets?: Pick<TicketService, "list" | "queue" | "statuses">;
  sessions?: Pick<SessionService, "list">;
  attention?: Pick<AttentionService, "list">;
  retro?: Pick<RetroService, "status">;
  brain?: Pick<BrainService, "health">;
  logs?: Pick<LogService, "runs" | "spendByDay">;
  usage?: Pick<UsageService, "snapshot">;
}

/** One data source: `disabled` when its module is off, `error` when a read threw. */
export type Part<T> = { state: "disabled" } | { state: "error"; message: string } | { state: "ok"; value: T };

export interface CommandCenterData {
  tickets: Part<{ issues: Issue[]; statuses: StatusDef[]; queue: Issue[] }>;
  sessions: Part<SessionInfo[]>;
  attention: Part<AttentionInfo[]>;
  retro: Part<RetroStatus>;
  brain: Part<BrainHealth>;
  logs: Part<{ runs: RunIndexEntry[]; spend: SpendDay[] }>;
  usage: Part<AccountUsage[]>;
}

export const SPEND_DAYS = 30;
export const RECENT_RUNS = 5;

async function part<S, T>(svc: S | undefined, read: (s: S) => T | Promise<T>): Promise<Part<T>> {
  if (svc === undefined) return { state: "disabled" };
  try {
    return { state: "ok", value: await read(svc) };
  } catch (e) {
    return { state: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** Reads every enabled service once. Only read methods are called. */
export async function loadCommandCenterData(r: CommandCenterReader): Promise<CommandCenterData> {
  return {
    tickets: await part(r.tickets, (t) => ({ issues: t.list(), statuses: t.statuses(), queue: t.queue() })),
    sessions: await part(r.sessions, (s) => s.list()),
    attention: await part(r.attention, (a) => a.list()),
    retro: await part(r.retro, (x) => x.status()),
    brain: await part(r.brain, (b) => b.health()),
    usage: await part(r.usage, (u) => u.snapshot()),
    logs: await part(r.logs, async (l) => ({ runs: await l.runs({ limit: RECENT_RUNS }), spend: await l.spendByDay(SPEND_DAYS) })),
  };
}

/** Local calendar day as `YYYY-MM-DD`. */
export function dayKey(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface SpendTotals {
  today: number;
  last7: number;
  last30: number;
}

/** Sums spend per local day; `last7` covers today and the six days before it. */
export function spendTotals(spend: readonly SpendDay[], now: Date): SpendTotals {
  const today = dayKey(now);
  const weekStart = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
  const totals: SpendTotals = { today: 0, last7: 0, last30: 0 };
  for (const { day, costUsd } of spend) {
    totals.last30 += costUsd;
    if (day >= weekStart && day <= today) totals.last7 += costUsd;
    if (day === today) totals.today += costUsd;
  }
  return totals;
}

const fmtNum = (n: number): string => String(Math.round(n * 100) / 100);

/** SVG path data (`M`/`L` commands) for a sparkline in a `0 0 width height` viewBox. Empty input gives "". */
export function sparklinePath(values: readonly number[], width: number, height: number): string {
  if (values.length === 0) return "";
  const max = Math.max(...values, 0);
  const scale = max > 0 ? max : 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((v, i) => `${i === 0 ? "M" : "L"}${fmtNum(i * step)} ${fmtNum(height - (Math.max(v, 0) / scale) * height)}`)
    .join(" ");
}

export const SPARKLINE_WIDTH = 300;
export const SPARKLINE_HEIGHT = 48;

export interface Tile {
  id: string;
  label: string;
  /** Display value, or the degradation text (`module disabled`, `unavailable`). */
  value: string;
  detail?: string;
  state: "ok" | "disabled" | "error";
}

export interface AttentionRow {
  sessionId: string;
  ticketId: string;
  reason: string;
  since: string;
}

export interface RunRow {
  runId: string;
  ticketId?: string;
  outcome: string;
  costUsd: number;
  start: string;
}

export interface ProposalRow {
  id: string;
  title: string;
  status: string;
}

/** One account's bars (subscription) or dollars (enterprise) on the usage tile. */
export interface UsageRow {
  accountId: string;
  label: string;
  /** "estimate" unless an official reading was fetched. */
  source: AccountUsage["source"];
  /** Subscription accounts: two bars. Enterprise accounts have none. */
  bars?: { id: "session" | "week"; label: string; percent: number; reset: string }[];
  /** Enterprise accounts: dollars, never a percent of a plan cap. */
  dollars?: { today: string; month: string; budget?: string; budgetPercent?: number };
}

export interface CommandCenterModel {
  tiles: Tile[];
  usage: Part<UsageRow[]>;
  attention: Part<AttentionRow[]>;
  recentRuns: Part<RunRow[]>;
  proposals: Part<ProposalRow[]>;
  sparkline: Part<{ path: string; total: number }>;
}

/** Pure: turns loaded data into tiles and lists. No services, no DOM. */
export function buildCommandCenterModel(d: CommandCenterData, now: Date): CommandCenterModel {
  const tile = (id: string, label: string, p: Part<unknown>, ok: () => Pick<Tile, "value" | "detail">): Tile => {
    if (p.state === "disabled") return { id, label, value: "module disabled", state: "disabled" };
    if (p.state === "error") return { id, label, value: "unavailable", state: "error" };
    return { id, label, state: "ok", ...ok() };
  };

  const triage = d.tickets.state === "ok" ? triageIssues(d.tickets.value.issues, d.tickets.value.statuses).length : undefined;
  const sessionsRunning = d.sessions.state === "ok" ? d.sessions.value.filter((s) => s.state !== "exited").length : undefined;

  const tiles: Tile[] = [
    tile("triage", "Triage", d.tickets, () => ({ value: String(triage) })),
    tile("queue", "Queue", d.tickets, () => ({ value: String(d.tickets.state === "ok" ? d.tickets.value.queue.length : 0) })),
    tile("running", "Running", d.sessions, () => ({ value: String(sessionsRunning) })),
    tile("needs-attention", "Needs attention", d.attention, () => ({ value: String(d.attention.state === "ok" ? d.attention.value.length : 0) })),
    tile("spend", "Spend", d.logs, () => {
      const t = spendTotals(d.logs.state === "ok" ? d.logs.value.spend : [], now);
      return { value: `$${t.today.toFixed(2)} today`, detail: `7d $${t.last7.toFixed(2)} · 30d $${t.last30.toFixed(2)}` };
    }),
    tile("brain", "Brain health", d.brain, () => ({ value: String(d.brain.state === "ok" ? d.brain.value.vault.score : 0), detail: "vault" })),
    tile("retro", "Retro nudge", d.retro, () => {
      const r = d.retro.state === "ok" ? d.retro.value : undefined;
      return { value: `${r?.sessionsSince ?? 0} sessions since last retro`, detail: `last retro: ${r?.lastRetroAt ?? "never"}` };
    }),
  ];

  const attention: Part<AttentionRow[]> =
    d.attention.state === "ok"
      ? { state: "ok", value: d.attention.value.map((a) => ({ sessionId: a.sessionId, ticketId: a.ticketId, reason: a.reason, since: new Date(a.since).toISOString() })) }
      : d.attention;

  const recentRuns: Part<RunRow[]> =
    d.logs.state === "ok"
      ? {
          state: "ok",
          value: [...d.logs.value.runs]
            .sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0))
            .slice(0, RECENT_RUNS)
            .map((r) => ({ runId: r.runId, ticketId: r.ticketId, outcome: r.outcome ?? "running", costUsd: r.costUsd, start: r.start })),
        }
      : d.logs;

  const proposals: Part<ProposalRow[]> =
    d.tickets.state !== "ok"
      ? d.tickets
      : (() => {
          const { issues, statuses } = d.tickets.value;
          const closed = new Set(statuses.filter((s) => s.category === "completed" || s.category === "canceled").map((s) => s.name));
          return {
            state: "ok" as const,
            value: issues.filter((i) => i.type === "proposal" && !closed.has(i.status)).map((i) => ({ id: i.id, title: i.title, status: i.status })),
          };
        })();

  const sparkline: Part<{ path: string; total: number }> =
    d.logs.state === "ok"
      ? {
          state: "ok",
          value: {
            path: sparklinePath(d.logs.value.spend.map((s) => s.costUsd), SPARKLINE_WIDTH, SPARKLINE_HEIGHT),
            total: spendTotals(d.logs.value.spend, now).last30,
          },
        }
      : d.logs;

  const usage: Part<UsageRow[]> =
    d.usage.state === "ok"
      ? { state: "ok", value: d.usage.value.map((u) => usageRow(u, now.getTime())) }
      : d.usage;

  return { tiles, usage, attention, recentRuns, proposals, sparkline };
}

function usageRow(u: AccountUsage, now: number): UsageRow {
  const row: UsageRow = { accountId: u.accountId, label: u.label, source: u.source };
  if (u.enterprise) {
    const e = u.enterprise;
    row.dollars = { today: `$${e.todayUsd.toFixed(2)}`, month: `$${e.monthUsd.toFixed(2)}` };
    if (e.budget.monthUsd) {
      row.dollars.budget = `$${e.budget.monthUsd.toFixed(2)}`;
      if (e.monthBudgetPercent !== undefined) row.dollars.budgetPercent = e.monthBudgetPercent;
    }
  } else if (u.subscription) {
    row.bars = [
      { id: "session", label: "Session", percent: u.subscription.sessionPercent, reset: u.session.active ? formatCountdown(u.session.resetsAt, now) : "" },
      { id: "week", label: "Week", percent: u.subscription.weekPercent, reset: formatCountdown(u.week.resetsAt, now) },
    ];
  }
  return row;
}
