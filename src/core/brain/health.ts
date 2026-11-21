/** Pure brain health score (ADR-0007 weights; settings `brain.healthWeights`). */
export interface HealthCounts {
  lintErrors: number;
  lintWarnings: number;
  stalenessIssues: number;
}

export interface HealthWeights {
  lintError: number;
  lintWarning: number;
  stalenessIssue: number;
}

export const DEFAULT_HEALTH_WEIGHTS: HealthWeights = { lintError: 5, lintWarning: 1, stalenessIssue: 2 };

/** `max(0, 100 - 5 × lintErrors - 2 × stalenessIssues - 1 × lintWarnings)` with default weights. */
export function healthScore(counts: HealthCounts, weights: HealthWeights = DEFAULT_HEALTH_WEIGHTS): number {
  return Math.max(0, 100 - weights.lintError * counts.lintErrors - weights.stalenessIssue * counts.stalenessIssues - weights.lintWarning * counts.lintWarnings);
}

export function sumCounts(list: readonly HealthCounts[]): HealthCounts {
  return list.reduce<HealthCounts>(
    (acc, c) => ({ lintErrors: acc.lintErrors + c.lintErrors, lintWarnings: acc.lintWarnings + c.lintWarnings, stalenessIssues: acc.stalenessIssues + c.stalenessIssues }),
    { lintErrors: 0, lintWarnings: 0, stalenessIssues: 0 },
  );
}
