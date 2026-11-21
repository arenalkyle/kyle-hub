import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runUsage } from "../../../cli/commands/usage/cli";
import type { Io } from "../../../cli/commands/tickets/cli";
import type { Account } from "../../core/accounts";
import {
  computeAccountUsage,
  formatCountdown,
  sessionWindow,
  startOfLocalDay,
  startOfLocalMonth,
  thresholdHits,
  usageLine,
  weekWindow,
  type OffsetFn,
} from "../../core/domain/usage";
import { FileLogService } from "../../core/logs/service";
import type { Profile, UsageEvent } from "../../core/logs/types";
import { parseOfficialUsage, cliOfficialReader } from "./official";
import { buildCommandCenterModel, loadCommandCenterData } from "../command-center/model";
import { DEFAULT_USAGE_SETTINGS, usageSettingsOf, UsageTracker } from "../../core/usage/service";

const H = 3_600_000;
const ev = (t: string, tokens = 1000, costUsd = 0.01): UsageEvent => ({ t, tokens, costUsd });
const T0 = Date.parse("2026-11-20T10:00:00Z");

describe("session window", () => {
  it("starts at the first message and ends 5 h later", () => {
    const w = sessionWindow([ev("2026-11-20T10:00:00Z"), ev("2026-11-20T12:00:00Z")], T0 + 3 * H);
    expect(w).toMatchObject({ active: true, tokens: 2000, messages: 2, startsAt: "2026-11-20T10:00:00.000Z", resetsAt: "2026-11-20T15:00:00.000Z" });
  });

  it("rolls over: the first message after the block ended starts the next block", () => {
    const events = [ev("2026-11-20T10:00:00Z", 100), ev("2026-11-20T14:59:00Z", 100), ev("2026-11-20T16:30:00Z", 500)];
    const w = sessionWindow(events, Date.parse("2026-11-20T17:00:00Z"));
    expect(w).toMatchObject({ active: true, tokens: 500, messages: 1, startsAt: "2026-11-20T16:30:00.000Z", resetsAt: "2026-11-20T21:30:00.000Z" });
  });

  it("a message exactly at block end starts a new block", () => {
    const w = sessionWindow([ev("2026-11-20T10:00:00Z", 1), ev("2026-11-20T15:00:00Z", 7)], Date.parse("2026-11-20T15:01:00Z"));
    expect(w.tokens).toBe(7);
  });

  it("is inactive with zero usage once the last block ended", () => {
    const w = sessionWindow([ev("2026-11-20T10:00:00Z")], Date.parse("2026-11-20T16:00:00Z"));
    expect(w).toMatchObject({ active: false, tokens: 0, messages: 0 });
  });
});

describe("week window", () => {
  it("rolls old messages off after 7 days and resets when the oldest rolls off", () => {
    const events = [ev("2026-11-10T09:00:00Z", 10), ev("2026-11-14T12:00:00Z", 20), ev("2026-11-20T09:00:00Z", 30)];
    const w = weekWindow(events, Date.parse("2026-11-21T09:00:00Z"));
    expect(w).toMatchObject({ tokens: 50, messages: 2, startsAt: "2026-11-14T12:00:00.000Z", resetsAt: "2026-11-21T12:00:00.000Z" });
  });

  it("an exactly 7 d old message is out", () => {
    expect(weekWindow([ev("2026-11-14T09:00:00Z")], Date.parse("2026-11-21T09:00:00Z")).messages).toBe(0);
  });
});

/** US Eastern: DST began 2026-03-08 07:00Z (clocks 02:00 -> 03:00), ended 2026-11-01 06:00Z. */
const eastern: OffsetFn = (ms) => (ms >= Date.parse("2026-03-08T07:00:00Z") && ms < Date.parse("2026-11-01T06:00:00Z") ? 240 : 300);

describe("DST", () => {
  it("the 7 d window is absolute time across a DST change", () => {
    const now = Date.parse("2026-03-10T12:00:00Z");
    const w = weekWindow([ev("2026-03-03T11:59:00Z"), ev("2026-03-03T12:01:00Z")], now);
    expect(w.messages).toBe(1);
  });

  it("local day start follows the offset on a 23 h spring-forward day", () => {
    const noon = Date.parse("2026-03-08T16:00:00Z"); // 12:00 EDT
    expect(new Date(startOfLocalDay(noon, eastern)).toISOString()).toBe("2026-03-08T05:00:00.000Z"); // midnight EST
    const next = Date.parse("2026-03-09T16:00:00Z");
    expect(new Date(startOfLocalDay(next, eastern)).toISOString()).toBe("2026-03-09T04:00:00.000Z"); // midnight EDT
    expect(startOfLocalDay(next, eastern) - startOfLocalDay(noon, eastern)).toBe(23 * H);
  });

  it("local month start crosses the fall-back change", () => {
    const nov = Date.parse("2026-11-21T12:00:00Z");
    expect(new Date(startOfLocalMonth(nov, eastern)).toISOString()).toBe("2026-11-01T04:00:00.000Z"); // midnight EDT on Nov 1
  });

  it("enterprise today counts only the local day", () => {
    const now = Date.parse("2026-03-08T16:00:00Z");
    const events = [ev("2026-03-08T04:30:00Z", 1, 1), ev("2026-03-08T05:30:00Z", 1, 2), ev("2026-03-08T15:00:00Z", 1, 4)];
    const u = computeAccountUsage({ id: "e", label: "E", kind: "enterprise", plan: "" }, events, now, { offset: eastern });
    expect(u.enterprise).toMatchObject({ todayUsd: 6, monthUsd: 7 });
  });
});

describe("accounts", () => {
  const sub = { id: "m", label: "Main", kind: "subscription", plan: "pro" } as const;
  const ent = { id: "e", label: "Corp", kind: "enterprise", plan: "" } as const;
  const now = Date.parse("2026-11-20T11:00:00Z");

  it("subscription percent = used / calibrated cap", () => {
    const u = computeAccountUsage(sub, [ev("2026-11-20T10:00:00Z", 250_000)], now, { caps: { default: { session: 1, week: 1 }, pro: { session: 500_000, week: 5_000_000 } } });
    expect(u.subscription).toMatchObject({ sessionPercent: 50, weekPercent: 5 });
    expect(u.enterprise).toBeUndefined();
    expect(usageLine(u, now)).toContain("50%");
  });

  it("enterprise renders dollars and never a percent of a plan cap", () => {
    const u = computeAccountUsage(ent, [ev("2026-11-20T10:00:00Z", 9_999_999, 1.5)], now, { budget: { monthUsd: 10 }, offset: () => 0 });
    expect(u.subscription).toBeUndefined();
    expect(u.enterprise).toMatchObject({ todayUsd: 1.5, monthUsd: 1.5, monthBudgetPercent: 15 });
    const line = usageLine(u, now);
    expect(line).toContain("$1.50 today");
    expect(line).toContain("$10.00");
    expect(line).not.toMatch(/session \d|week \d/);
  });

  it("unknown plan falls back to the default cap", () => {
    const u = computeAccountUsage({ ...sub, plan: "mystery" }, [ev("2026-11-20T10:00:00Z", 100_000)], now);
    expect(u.subscription?.cap).toEqual(DEFAULT_USAGE_SETTINGS.caps.default);
  });

  it("thresholds: subscription windows and enterprise budget", () => {
    const u = computeAccountUsage(sub, [ev("2026-11-20T10:00:00Z", 450_000)], now, { caps: { default: { session: 500_000, week: 1e9 } } });
    expect(thresholdHits(u, 80, now).map((h) => h.window)).toEqual(["session"]);
    const e = computeAccountUsage(ent, [ev("2026-11-20T10:00:00Z", 1, 9)], now, { budget: { monthUsd: 10 }, offset: () => 0 });
    expect(thresholdHits(e, 80, now, () => 0).map((h) => h.window)).toEqual(["month"]);
  });

  it("formats countdowns", () => {
    expect(formatCountdown("2026-11-20T13:05:00Z", Date.parse("2026-11-20T11:00:00Z"))).toBe("2h 05m");
    expect(formatCountdown("2026-11-24T15:00:00Z", Date.parse("2026-11-20T11:00:00Z"))).toBe("4d 4h");
    expect(formatCountdown("2026-11-20T10:00:00Z", now)).toBe("now");
  });
});

const acc = (id: string, kind: Account["kind"] = "subscription", plan = "pro"): Account => ({ id, label: id.toUpperCase(), kind, plan, configDir: `C:/cfg/${id}` });

describe("UsageTracker", () => {
  const now = Date.parse("2026-11-20T11:00:00Z");
  const logsWith = (events: (UsageEvent & { accountId: string })[]) => ({ usageEvents: async () => events });

  it("with officialReading off it never calls the official reader and only reads usage events", async () => {
    const official = vi.fn();
    const usageEvents = vi.fn(async () => [{ ...ev("2026-11-20T10:00:00Z"), accountId: "m" }]);
    const t = new UsageTracker({ logs: () => ({ usageEvents }), accounts: () => [acc("m")], settings: () => usageSettingsOf({}), now: () => now, official, cacheMs: 0 });
    const [u] = await t.snapshot();
    expect(u?.source).toBe("estimate");
    expect(official).not.toHaveBeenCalled();
    expect(usageEvents).toHaveBeenCalledTimes(1);
  });

  it("the usage core has no file or network imports", () => {
    for (const f of ["../../core/domain/usage.ts", "../../core/usage/service.ts"]) {
      const src = fs.readFileSync(path.join(__dirname, f), "utf8");
      expect(src).not.toMatch(/from "node:(fs|http|https|net|child_process)"|fetch\(|credentials/);
    }
  });

  it("official reading on: used and labeled; failure falls back to the estimate", async () => {
    const settings = () => usageSettingsOf({ officialReading: true });
    const base = { logs: () => logsWith([{ ...ev("2026-11-20T10:00:00Z", 250_000), accountId: "m" }]), accounts: () => [acc("m"), acc("e", "enterprise")], settings, now: () => now, cacheMs: 0 };
    const ok = await new UsageTracker({ ...base, official: async () => ({ sessionPercent: 61, weekPercent: 9 }) }).snapshot();
    expect(ok[0]).toMatchObject({ source: "official", subscription: { sessionPercent: 61, weekPercent: 9 } });
    expect(ok[1]?.source).toBe("estimate");
    const bad = await new UsageTracker({ ...base, official: async () => { throw new Error("offline"); } }).snapshot();
    expect(bad[0]).toMatchObject({ source: "estimate", subscription: { sessionPercent: 50 } });
  });

  it("fires a threshold once per window instance", async () => {
    const hits: unknown[] = [];
    const events = [{ ...ev("2026-11-20T10:00:00Z", 450_000), accountId: "m" }];
    const t = new UsageTracker({
      logs: () => logsWith(events),
      accounts: () => [acc("m")],
      settings: () => usageSettingsOf({ caps: { pro: { session: 500_000, week: 1e12 } } }),
      now: () => now,
      onThreshold: (h) => hits.push(h),
      cacheMs: 0,
    });
    await t.check();
    await t.check();
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ accountId: "m", window: "session", windowStart: "2026-11-20T10:00:00.000Z" });
  });

  it("settings: bad entries are ignored, caps merge over defaults", () => {
    const s = usageSettingsOf({ caps: { PRO: { session: 5 }, x: "no" }, budgets: { e: { monthUsd: 20, dayUsd: -1 } }, warnPercent: "x", officialReading: "yes" });
    expect(s.caps.pro).toEqual({ session: 5, week: 5_000_000 });
    expect(s.budgets.e).toEqual({ monthUsd: 20 });
    expect(s.warnPercent).toBe(80);
    expect(s.officialReading).toBe(false);
  });
});

describe("official parser", () => {
  it("reads session and week percentages, rejects partial text", () => {
    expect(parseOfficialUsage("Current session: 42% used\nCurrent week (all models): 17% used")).toEqual({ sessionPercent: 42, weekPercent: 17 });
    expect(parseOfficialUsage("Current session: 42% used")).toBeUndefined();
  });

  it("the CLI reader passes only CLAUDE_CONFIG_DIR and propagates failure", async () => {
    const run = vi.fn(async (..._a: unknown[]) => "Session 10%\nWeek 20%");
    expect(await cliOfficialReader("claude", run)(acc("m"))).toEqual({ sessionPercent: 10, weekPercent: 20 });
    expect(run.mock.calls[0]?.[2]).toEqual({ CLAUDE_CONFIG_DIR: "C:/cfg/m" });
    await expect(cliOfficialReader("claude", async () => { throw new Error("x"); })(acc("m"))).rejects.toThrow();
  });
});

describe("dashboard usage section", () => {
  const baseReader = { tickets: undefined, sessions: undefined, attention: undefined, retro: undefined, brain: undefined, logs: undefined };

  it("renders with the usage module disabled", async () => {
    const m = buildCommandCenterModel(await loadCommandCenterData(baseReader), new Date("2026-11-20T11:00:00Z"));
    expect(m.usage).toEqual({ state: "disabled" });
    expect(m.tiles.length).toBeGreaterThan(0);
  });

  it("subscription rows have two bars, enterprise rows dollars", async () => {
    const now = Date.parse("2026-11-20T11:00:00Z");
    const snap = [
      computeAccountUsage({ id: "m", label: "Main", kind: "subscription", plan: "pro" }, [ev("2026-11-20T10:00:00Z", 250_000)], now),
      computeAccountUsage({ id: "e", label: "Corp", kind: "enterprise", plan: "" }, [ev("2026-11-20T10:00:00Z", 1, 3)], now, { offset: () => 0, budget: { monthUsd: 30 } }),
    ];
    const m = buildCommandCenterModel(await loadCommandCenterData({ ...baseReader, usage: { snapshot: async () => snap } }), new Date(now));
    expect(m.usage.state === "ok" && m.usage.value[0]?.bars?.map((b) => b.id)).toEqual(["session", "week"]);
    expect(m.usage.state === "ok" && m.usage.value[0]?.bars?.[0]?.reset).toBe("4h 00m");
    expect(m.usage.state === "ok" && m.usage.value[1]).toMatchObject({ dollars: { today: "$3.00", month: "$3.00", budget: "$30.00" } });
    expect(m.usage.state === "ok" && m.usage.value[1]?.bars).toBeUndefined();
  });
});

describe("FileLogService.usageEvents and kh usage", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kh-usage-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const seed = (cfg: string, sid: string, ts: string): void => {
    const p = path.join(root, cfg, "projects", "proj");
    fs.mkdirSync(p, { recursive: true });
    const line = { type: "assistant", uuid: "a", sessionId: sid, timestamp: ts, cwd: "C:\\work\\demo", message: { id: `m-${sid}`, model: "claude-test-1", role: "assistant", content: [{ type: "text", text: "hi" }], usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 300, cache_creation_input_tokens: 50 } } };
    fs.writeFileSync(path.join(p, `${sid}.jsonl`), `${JSON.stringify({ type: "user", uuid: "u", sessionId: sid, timestamp: ts, cwd: "C:\\work\\demo", message: { role: "user", content: "x" } })}\n${JSON.stringify(line)}\n`);
  };
  const svc = () =>
    new FileLogService({
      dataRoot: (p: Profile) => path.join(root, "data", p),
      projectsDir: path.join(root, "none", "projects"),
      accounts: [{ id: "main", configDir: path.join(root, "cfg-main") }, { id: "alt", configDir: path.join(root, "cfg-alt") }],
      prices: { "claude-test-1": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
    });

  it("returns per-account events (input + output + cache write) and honors since", async () => {
    seed("cfg-main", "s1", "2026-11-20T10:00:00.000Z");
    seed("cfg-alt", "s2", "2026-11-01T10:00:00.000Z");
    const s = svc();
    await s.ingest();
    const all = await s.usageEvents("2026-10-01T00:00:00Z");
    expect(all.map((e) => [e.accountId, e.tokens])).toEqual([["alt", 170], ["main", 170]]);
    expect(all[0]?.costUsd).toBeGreaterThan(0);
    expect((await s.usageEvents("2026-11-10T00:00:00Z")).map((e) => e.accountId)).toEqual(["main"]);
    expect(await s.usageEvents("2026-10-01T00:00:00Z", "alt")).toHaveLength(1);
  });

  it("kh usage prints a line per account, --json and --account", async () => {
    seed("cfg-main", "s1", "2026-11-20T10:00:00.000Z");
    const s = svc();
    await s.ingest();
    const vault = path.join(root, "vault");
    const dir = path.join(vault, ".obsidian", "plugins", "kyle-hub");
    fs.mkdirSync(dir, { recursive: true });
    const accounts = { list: [{ id: "main", label: "Main", kind: "subscription", plan: "pro", configDir: path.join(root, "cfg-main") }, { id: "corp", label: "Corp", kind: "enterprise", plan: "", configDir: path.join(root, "cfg-corp") }], default: "main" };
    fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify({ schemaVersion: 1, modules: { core: { accounts }, usage: { caps: { pro: { session: 1000, week: 10_000 } } } } }));
    const out: string[] = [];
    const io: Io = { cwd: root, env: { KYLE_HUB_VAULTS: vault }, stdin: () => "", out: (x) => out.push(x), err: () => undefined, now: () => new Date("2026-11-20T11:00:00Z") };
    expect(await runUsage([], io, s)).toBe(0);
    expect(out[0]).toContain("Main: session 17%");
    expect(out[1]).toContain("Corp: $0.00 today");
    out.length = 0;
    await runUsage(["--json", "--account", "main"], io, s);
    const j = JSON.parse(out.join("\n")) as { accountId: string; subscription: { sessionPercent: number } }[];
    expect(j).toHaveLength(1);
    expect(j[0]).toMatchObject({ accountId: "main", subscription: { sessionPercent: 17 } });
    await expect(runUsage(["--account", "nope"], io, s)).rejects.toThrow(/No account/);
  });
});
