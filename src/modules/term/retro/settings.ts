/** `term.retro.*` settings for the retro run itself (detection thresholds live in `config.ts`). */
export interface RetroSettings {
  /** Highlight the sessions-since-retro nudge from this many sessions. */
  nudgeAt: number;
  /** Max new tickets per retro. */
  maxTickets: number;
  /** Opt-in: show the Draft rule with Haiku button. */
  allowDraftRule: boolean;
  /** Per-day Haiku spend cap in USD. */
  dailyCapUsd: number;
}

export const DEFAULT_RETRO_SETTINGS: Readonly<RetroSettings> = { nudgeAt: 10, maxTickets: 5, allowDraftRule: false, dailyCapUsd: 0.25 };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function resolveRetroSettings(raw: unknown): RetroSettings {
  const r = isObj(raw) ? raw : {};
  const int = (v: unknown, d: number): number => (typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : d);
  const d = DEFAULT_RETRO_SETTINGS;
  return {
    nudgeAt: int(r.nudgeAt, d.nudgeAt),
    maxTickets: int(r.maxTickets, d.maxTickets),
    allowDraftRule: r.allowDraftRule === true,
    dailyCapUsd: typeof r.dailyCapUsd === "number" && Number.isFinite(r.dailyCapUsd) && r.dailyCapUsd >= 0 ? r.dailyCapUsd : d.dailyCapUsd,
  };
}
