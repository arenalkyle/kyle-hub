import type { DerivedRecord, LogService, Profile, RunIndexEntry, RunQuery, SpendDay } from "./types";

type Source = Pick<LogService, "runs" | "run" | "records" | "spendByDay">;
/** Read-only view limited to one profile's runs (the dashboard and retro read only the vault's profile). */
export type ScopedLogs = Pick<LogService, "runs" | "records" | "spendByDay">;

export function scopeLogs(logs: Source, profile: Profile): ScopedLogs {
  return {
    runs: (q: RunQuery = {}): Promise<RunIndexEntry[]> => logs.runs({ ...q, profile }),
    async *records(runId: string): AsyncIterable<DerivedRecord> {
      const entry = await logs.run(runId);
      if (entry && entry.profile !== profile) return;
      yield* logs.records(runId);
    },
    spendByDay: (days: number): Promise<SpendDay[]> => logs.spendByDay(days, profile),
  };
}
