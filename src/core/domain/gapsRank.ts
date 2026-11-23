import type { GradedNote } from "./gaps";

/** Default doc-gap cutoff (score under this counts as a gap). Overridden by the Command Center setting. */
export const DEFAULT_GAPS_CUTOFF = 70;

/** Notes scoring under the cutoff, worst first (lowest score, then path). */
export function worstFirst(grades: readonly GradedNote[], cutoff: number): GradedNote[] {
  return grades.filter((g) => g.score < cutoff).sort((a, b) => a.score - b.score || a.path.localeCompare(b.path));
}

/** Note name without its folder or `.md` extension. */
export function noteName(notePath: string): string {
  return notePath.slice(notePath.lastIndexOf("/") + 1).replace(/\.md$/, "");
}
