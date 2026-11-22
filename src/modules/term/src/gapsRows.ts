import type { GapsReport } from "../../../core/domain/gaps";

/** Notes scoring below this are listed in the terminal Gaps tab. */
export const GAPS_CUTOFF = 70;

export interface GapRow {
  /** Vault-relative path, used to open the note. */
  path: string;
  name: string;
  grade: string;
  /** `reasons` without its leading `<grade> <score>: ` prefix. */
  reason: string;
}

/** Worst-first rows for notes under `cutoff`. */
export function gapRows(report: GapsReport, cutoff = GAPS_CUTOFF): GapRow[] {
  return report.grades
    .filter((g) => g.score < cutoff)
    .sort((a, b) => a.score - b.score)
    .map((g) => ({
      path: g.path,
      name: (g.path.split("/").pop() ?? g.path).replace(/\.md$/i, ""),
      grade: g.grade,
      reason: g.reasons.replace(/^\S+ \d+: /, ""),
    }));
}
