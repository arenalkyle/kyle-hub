import { describe, expect, it, vi } from "vitest";
import type { Issue, StatusDef } from "../../core/domain/types";
import { buildCommandCenterModel, loadCommandCenterData, sparklinePath, spendTotals, type CommandCenterReader } from "./model";

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
    retro: { status: async () => ({ sessionsSince: 4, nudgeAt: 10, lastRetroAt: "2026-11-15T10:00:00Z" }) },
    brain: { health: () => ({ vault: { score: 87 }, repos: {} }) },
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
