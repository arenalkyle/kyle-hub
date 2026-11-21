import type { RunIndexEntry } from "../../../../core/logs/types";
import type { RetroConfig, Signal } from "../types";

/** Nearest-rank p90. */
export function p90(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(0.9 * sorted.length) - 1] ?? 0;
}

/**
 * `out:<type>:cost|duration` for runs above `outlierFactor` x p90 of their ticket type.
 * Needs at least `outlierMinRuns` runs of that type; runs with no known type are skipped.
 */
export function outliers(runs: readonly RunIndexEntry[], cfg: RetroConfig, ticketTypes: ReadonlyMap<string, string>): Signal[] {
  const byType = new Map<string, RunIndexEntry[]>();
  for (const run of runs) {
    const type = run.ticketId ? ticketTypes.get(run.ticketId) : undefined;
    if (!type) continue;
    byType.set(type, [...(byType.get(type) ?? []), run]);
  }
  const out: Signal[] = [];
  for (const [type, group] of byType) {
    if (group.length < cfg.outlierMinRuns) continue;
    const metrics = [
      { name: "cost", of: (r: RunIndexEntry) => r.costUsd },
      { name: "duration", of: (r: RunIndexEntry) => r.durationMs },
    ];
    for (const m of metrics) {
      const limit = cfg.outlierFactor * p90(group.map(m.of));
      for (const run of group) {
        if (m.of(run) > limit) {
          out.push({ kind: "outlier", signature: `out:${type}:${m.name}`, runId: run.runId, sessionId: run.sessionId, repo: run.repo, t: run.start });
        }
      }
    }
  }
  return out;
}
