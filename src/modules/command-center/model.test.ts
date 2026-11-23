import { describe, expect, it, vi } from "vitest";
import type { Issue, StatusDef } from "../../core/domain/types";
import {
  activeAgentCount,
  activeSeries,
  buildCommandCenterModel,
  bucketCounts,
  formatRate,
  humanOpenCount,
  loadCommandCenterData,
  mergeVitalsSamples,
  noteReadCount,
  normalizeRateUnit,
  sparklinePath,
  spendTotals,
  vitalsSamples,
  type CommandCenterReader,
  type VitalsSample,
} from "./model";

const NOW = new Date(2026, 10, 21, 12, 0, 0);
const STATUSES = [
  { name: "Inbox", category: "triage" },
  { name: "Ready", category: "unstarted" },
  { name: "Shipped", category: "completed" },
] as unknown as StatusDef[];

const issue = (over: Partial<Issue>): Issue =>
  ({ id: "T-1", title: "t", status: "Ready", tags: [], created: "2026-11-20 09:00", ...over }) as unknown as Issue;

function fullReader(): Record<keyof CommandCenterReader, Record<string, unknown>> {
  const issues = [
    issue({ id: "T-1", status: "Inbox" }),
    issue({ id: "T-2", status: "Ready" }),
    issue({ id: "P-1", type: "proposal", status: "Ready", title: "open proposal" }),
    issue({ id: "P-2", type: "proposal", status: "Shipped", title: "closed proposal" }),
  ];
  return {
    tickets: { list: () => issues, queue: () => [issues[1]], statuses: () => STATUSES },
    sessions: { list: () => [{ id: "a", state: "working" }, { id: "b", state: "exited" }] },
    attention: { list: () => [{ sessionId: "a", ticketId: "T-2", runId: "r1", reason: "stalled", since: NOW.getTime() }] },
    retro: { status: async () => ({ sessionsSince: 4, nudgeAt: 10, lastRetroAt: "2026-11-15T10:00:00Z" }), perform: async () => ({ created: [], seenAgain: [], skipped: [], recurred: [], resolved: [] }) },
    gaps: { read: () => undefined, onChange: () => () => undefined },
    brain: { health: () => ({ vault: { score: 87 }, repos: {} }) },
    usage: { snapshot: async () => [] },
    logs: {
      runs: async () => [
        { runId: "old", start: "2026-11-01T00:00:00Z", costUsd: 1, outcome: "done" },
        { runId: "new", ticketId: "T-2", start: "2026-11-21T09:00:00Z", costUsd: 2.5 },
      ],
      spendByDay: async () => [
        { day: "2026-11-21", costUsd: 3 },
        { day: "2026-11-18", costUsd: 2 },
        { day: "2026-11-10", costUsd: 5 },
      ],
    },
  };
}

describe("loadCommandCenterData + buildCommandCenterModel", () => {
  it("renders every tile from a full reader", async () => {
    const full = fullReader();
    const m = buildCommandCenterModel(await loadCommandCenterData(full as unknown as CommandCenterReader), NOW);
    const byId = Object.fromEntries(m.tiles.map((t) => [t.id, t]));
    expect(byId.triage?.value).toBe("1");
    expect(byId.queue?.value).toBe("1");
    expect(byId.running?.value).toBe("1");
    expect(byId["needs-attention"]?.value).toBe("1");
    expect(byId.spend?.value).toBe("$3.00 today");
    expect(byId.spend?.detail).toBe("7d $5.00 · 30d $10.00");
    expect(byId.brain?.value).toBe("87");
    expect(byId.retro?.value).toBe("4 sessions since last retro");
    expect(m.proposals).toEqual({ state: "ok", value: [{ id: "P-1", title: "open proposal", status: "Ready" }] });
    expect(m.recentRuns).toMatchObject({ state: "ok", value: [{ runId: "new" }, { runId: "old", outcome: "done" }] });
  });

  it("degrades every tile when all modules are disabled", async () => {
    const m = buildCommandCenterModel(await loadCommandCenterData({}), NOW);
    expect(m.tiles).toHaveLength(7);
    expect(m.tiles.every((t) => t.state === "disabled" && t.value === "module disabled")).toBe(true);
    expect(m.attention.state).toBe("disabled");
    expect(m.recentRuns.state).toBe("disabled");
    expect(m.proposals.state).toBe("disabled");
    expect(m.sparkline.state).toBe("disabled");
  });

  it("renders all 16 module combinations; a disabled module only disables its own tiles", async () => {
    const full = fullReader();
    // Tiles per module: tickets -> triage, queue; term -> running, needs-attention, retro; brain -> brain; logs -> spend.
    const modules: { keys: (keyof CommandCenterReader)[]; tiles: number }[] = [
      { keys: ["tickets"], tiles: 2 },
      { keys: ["sessions", "attention", "retro"], tiles: 3 },
      { keys: ["brain"], tiles: 1 },
      { keys: ["logs"], tiles: 1 },
    ];
    for (let mask = 0; mask < 1 << modules.length; mask++) {
      const reader: Record<string, unknown> = {};
      let disabledTiles = 0;
      modules.forEach((mod, i) => {
        if (mask & (1 << i)) for (const k of mod.keys) reader[k] = full[k];
        else disabledTiles += mod.tiles;
      });
      const m = buildCommandCenterModel(await loadCommandCenterData(reader as CommandCenterReader), NOW);
      expect(m.tiles).toHaveLength(7);
      expect(m.tiles.filter((t) => t.state === "disabled")).toHaveLength(disabledTiles);
    }
  });

  it("reports a throwing read as an error state without failing the rest", async () => {
    const full = fullReader();
    full.brain = { health: () => { throw new Error("scan failed"); } };
    const m = buildCommandCenterModel(await loadCommandCenterData(full as unknown as CommandCenterReader), NOW);
    expect(m.tiles.find((t) => t.id === "brain")).toMatchObject({ state: "error", value: "unavailable" });
    expect(m.tiles.find((t) => t.id === "triage")?.state).toBe("ok");
  });

  it("never calls a write method", async () => {
    const writes = ["create", "update", "comment", "logEvent", "removeComment", "spawn", "close", "perform", "apply", "draft", "annotateRun", "ingest", "refreshHealth", "check"];
    const full = fullReader();
    const spies: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const svc of Object.values(full)) {
      for (const w of writes) {
        spies[w] ??= vi.fn();
        svc[w] = spies[w];
      }
    }
    buildCommandCenterModel(await loadCommandCenterData(full as unknown as CommandCenterReader), NOW);
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });
});

describe("spendTotals", () => {
  it("counts today, the seven-day window and the total", () => {
    const spend = [
      { day: "2026-11-14", costUsd: 100 },
      { day: "2026-11-16", costUsd: 1 },
      { day: "2026-11-21", costUsd: 2 },
    ];
    expect(spendTotals(spend, NOW)).toEqual({ today: 2, last7: 3, last30: 103 });
  });
});

describe("sparklinePath", () => {
  it("golden: three points across a 300x48 viewBox", () => {
    expect(sparklinePath([0, 1, 2], 300, 48)).toBe("M0 48 L150 24 L300 0");
  });

  it("handles empty, single and all-zero input", () => {
    expect(sparklinePath([], 300, 48)).toBe("");
    expect(sparklinePath([5], 300, 48)).toBe("M0 0");
    expect(sparklinePath([0, 0], 300, 48)).toBe("M0 48 L300 48");
  });
});

describe("brain vitals", () => {
  const NOW_MS = NOW.getTime();
  const MIN = 60_000;
  const at = (minutesAgo: number, over: Partial<VitalsSample> = {}): VitalsSample => ({ at: NOW_MS - minutesAgo * MIN, kind: "read", path: "a.md", sessionId: "s1", ...over });

  it("counts agent reads of notes only, and human opens apart", () => {
    const s = [at(1), at(2, { path: "img.png" }), at(3, { kind: "write" }), at(4, { kind: "human", path: "b.md", sessionId: undefined })];
    expect(noteReadCount(s)).toBe(1);
    expect(humanOpenCount(s)).toBe(1);
  });

  it("formats per hour as the count and per minute as the count over the 60-minute window", () => {
    expect(formatRate(120, "hour")).toBe("120 / h");
    expect(formatRate(120, "minute")).toBe("2.0 / min");
    expect(formatRate(1, "minute")).toBe("0.0 / min");
  });

  it("normalizes the rate unit, defaulting to per hour", () => {
    expect(normalizeRateUnit("minute")).toBe("minute");
    expect(normalizeRateUnit("hour")).toBe("hour");
    expect(normalizeRateUnit(undefined)).toBe("hour");
    expect(normalizeRateUnit("day")).toBe("hour");
  });

  it("merges history with live events, drops duplicates, invalid times and samples outside the hour", () => {
    const history = [at(5), at(70)];
    const live = [at(5), at(0, { kind: "search", path: undefined })];
    const merged = mergeVitalsSamples(history, live, NOW_MS);
    expect(merged).toHaveLength(2);
    expect(merged.every((x) => x.at > NOW_MS - 60 * MIN)).toBe(true);
    expect(mergeVitalsSamples([{ at: Number.NaN, kind: "read" }], [], NOW_MS)).toEqual([]);
  });

  it("buckets counts per minute, oldest first, and skips samples past the window", () => {
    const s = [at(0, { kind: "write" }), at(0.5, { kind: "write" }), at(59, { kind: "write" }), at(61, { kind: "write" })];
    const b = bucketCounts(s, NOW_MS, (x) => x.kind === "write");
    expect(b).toHaveLength(60);
    expect(b[59]).toBe(2);
    expect(b[0]).toBe(1);
    expect(b.reduce((a, n) => a + n, 0)).toBe(3);
  });

  it("counts distinct agents active in the last five minutes and per-minute series", () => {
    const s = [at(1, { sessionId: "a" }), at(2, { sessionId: "a" }), at(3, { sessionId: "b" }), at(9, { sessionId: "c" }), at(1, { kind: "human", sessionId: undefined })];
    expect(activeAgentCount(s, NOW_MS)).toBe(2);
    const series = activeSeries(s, NOW_MS);
    expect(series.reduce((a, n) => a + n, 0)).toBe(4);
    expect(series[58]).toBe(1);
  });

  it("turns spool records into samples", () => {
    const out = vitalsSamples(
      [{ t: "2026-11-21T11:59:00.000Z", kind: "search", sessionId: "s", path: "x" }],
      [{ t: "2026-11-21T11:58:00.000Z", path: "n.md" }],
    );
    expect(out).toEqual([
      { at: Date.parse("2026-11-21T11:59:00.000Z"), kind: "search", sessionId: "s", path: "x" },
      { at: Date.parse("2026-11-21T11:58:00.000Z"), kind: "human", path: "n.md" },
    ]);
  });

  it("loads vitals for the hour before now, and degrades when logs are off", async () => {
    const accessSince = vi.fn(async () => [{ t: "2026-11-21T11:30:00.000Z", kind: "read" as const, sessionId: "s", path: "a.md" }]);
    const humanOpensSince = vi.fn(async () => []);
    const d = await loadCommandCenterData({ logs: { runs: async () => [], spendByDay: async () => [], accessSince, humanOpensSince } } as unknown as CommandCenterReader, NOW);
    expect(accessSince).toHaveBeenCalledWith(new Date(NOW_MS - 60 * MIN).toISOString());
    expect(d.vitals).toMatchObject({ state: "ok", value: [{ kind: "read", path: "a.md" }] });
    expect((await loadCommandCenterData({}, NOW)).vitals.state).toBe("disabled");
  });
});
