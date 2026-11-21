import type { Issue, StatusCategory, StatusDef } from "./types";
import { categoryOf } from "./fields";
import type { GateResult } from "./gates";

export interface FloodSettings {
  /** New triage tickets per run id. */
  maxNewPerRun: number;
  /** Open triage tickets in total. */
  maxOpenTriage: number;
  /** Triage tickets untouched for this many days are canceled. */
  expireDays: number;
}

export const DEFAULT_FLOOD: FloodSettings = { maxNewPerRun: 5, maxOpenTriage: 25, expireDays: 14 };
export const CAP_EXIT = 3;

const inCategory = (i: Issue, statuses: readonly StatusDef[], c: StatusCategory): boolean =>
  categoryOf(i.status, statuses) === c;

/** An open (not completed or canceled) ticket with this fingerprint, if any. */
export function findDuplicate(issues: readonly Issue[], statuses: readonly StatusDef[], fingerprint: string): Issue | undefined {
  return issues.find((i) => i.fingerprint === fingerprint && !inCategory(i, statuses, "completed") && !inCategory(i, statuses, "canceled"));
}

/**
 * Refuses a new triage ticket when the run (keyed by its `source`) already made
 * `maxNewPerRun`, or the open triage count is at `maxOpenTriage`.
 */
export function checkCaps(
  issues: readonly Issue[],
  statuses: readonly StatusDef[],
  source: string,
  flood: FloodSettings = DEFAULT_FLOOD,
): GateResult {
  const runCount = issues.filter((i) => i.source === source).length;
  if (runCount >= flood.maxNewPerRun) {
    return { ok: false, exitCode: CAP_EXIT, message: `Per-run cap reached: ${source} already created ${runCount} (max ${flood.maxNewPerRun}).` };
  }
  const open = issues.filter((i) => inCategory(i, statuses, "triage")).length;
  if (open >= flood.maxOpenTriage) {
    return { ok: false, exitCode: CAP_EXIT, message: `Open triage cap reached: ${open} (max ${flood.maxOpenTriage}).` };
  }
  return { ok: true };
}

/** Triage tickets whose last update (else creation) is older than `days` before `now`. */
export function expiredTriage(issues: readonly Issue[], statuses: readonly StatusDef[], now: Date, days = DEFAULT_FLOOD.expireDays): Issue[] {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  return issues.filter((i) => {
    if (!inCategory(i, statuses, "triage")) return false;
    const stamp = i.updated ?? i.created;
    if (!stamp) return false;
    const t = new Date(stamp).getTime();
    return Number.isFinite(t) && t < cutoff;
  });
}
