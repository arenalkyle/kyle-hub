import { describe, expect, it } from "vitest";
import { scopeLogs } from "./scoped";
import type { DerivedRecord, RunIndexEntry } from "./types";

const entry = (runId: string, profile: "home" | "work"): RunIndexEntry =>
  ({ runId, sessionId: runId, profile, start: "2026-11-01T00:00:00Z", durationMs: 1, costUsd: 1, toolCalls: 0, errors: 0, denials: 0 }) as RunIndexEntry;
const all = [entry("h", "home"), entry("w", "work")];
const src = {
  runs: async (q: { profile?: string } = {}) => all.filter((e) => !q.profile || e.profile === q.profile),
  run: async (id: string) => all.find((e) => e.runId === id),
  records: async function* (): AsyncIterable<DerivedRecord> {
    yield { type: "x", t: "t" };
  },
  spendByDay: async (_d: number, p?: string) => [{ day: "d", costUsd: all.filter((e) => !p || e.profile === p).length }],
};

describe("scopeLogs", () => {
  it("limits runs, records and spend to the vault profile", async () => {
    const w = scopeLogs(src, "work");
    expect((await w.runs()).map((r) => r.runId)).toEqual(["w"]);
    expect((await w.spendByDay(7))[0]!.costUsd).toBe(1);
    const own: DerivedRecord[] = [];
    for await (const r of w.records("w")) own.push(r);
    expect(own).toHaveLength(1);
    const other: DerivedRecord[] = [];
    for await (const r of w.records("h")) other.push(r);
    expect(other).toHaveLength(0);
  });
});
