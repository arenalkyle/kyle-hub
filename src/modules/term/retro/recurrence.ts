import type { AppliedEntry } from "./state";
import type { Signal } from "./types";

export const QUIET_RETROS_TO_RESOLVE = 2;

export type RecurrenceVerdict =
  | { kind: "recurred"; entry: AppliedEntry; count: number }
  | { kind: "resolved"; entry: AppliedEntry }
  | { kind: "quiet"; entry: AppliedEntry };

/**
 * For every applied signature, counts this retro's signals after `appliedAt`. At least `minOccurrences` is a recurrence;
 * zero for two consecutive retros is resolved (once). Returns the verdicts and the updated entries.
 */
export function checkRecurrence(
  applied: readonly AppliedEntry[],
  signals: readonly Signal[],
  minOccurrences: number,
): { verdicts: RecurrenceVerdict[]; entries: AppliedEntry[] } {
  const verdicts: RecurrenceVerdict[] = [];
  const entries = applied.map((a): AppliedEntry => {
    if (a.resolved) return a;
    const count = signals.filter((s) => s.signature === a.signature && Date.parse(s.t) > Date.parse(a.appliedAt)).length;
    if (count >= minOccurrences) {
      const next = { ...a, quietRetros: 0 };
      verdicts.push({ kind: "recurred", entry: next, count });
      return next;
    }
    if (count > 0) return { ...a, quietRetros: 0 };
    const quiet = a.quietRetros + 1;
    if (quiet >= QUIET_RETROS_TO_RESOLVE) {
      const next = { ...a, quietRetros: quiet, resolved: true };
      verdicts.push({ kind: "resolved", entry: next });
      return next;
    }
    const next = { ...a, quietRetros: quiet };
    verdicts.push({ kind: "quiet", entry: next });
    return next;
  });
  return { verdicts, entries };
}
