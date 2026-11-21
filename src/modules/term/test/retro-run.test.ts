import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectiveType } from "../../../core/domain/fields";
import type { Issue, StatusDef } from "../../../core/domain/types";
import type { DerivedRecord, RunIndexEntry } from "../../../core/logs/types";
import type { TicketService } from "../../../core/services";
import { resolveRetroConfig } from "../retro/config";
import { buildPrompt, cleanRule, convertToProposal, draftRule, type LlmRunner } from "../retro/llm";
import { checkRecurrence } from "../retro/recurrence";
import { performRetro } from "../retro/run";
import { createRetroService } from "../retro/service";
import { DEFAULT_RETRO_SETTINGS, resolveRetroSettings } from "../retro/settings";
import { readRetroState, updateRetroState } from "../retro/state";
import type { TemplateContext } from "../retro/templates";
import { withDiff } from "../retro/ticketMeta";
import type { LogReader, Signal } from "../retro/types";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "kh-retro-run-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const STATUSES = [{ name: "Triage", category: "triage" }, { name: "Todo", category: "unstarted" }] as unknown as StatusDef[];

/** In-memory TicketService with the agent dedupe of 3.1 (same type/repo/title -> "seen again" comment). */
function fakeTickets() {
  const issues: Issue[] = [];
  const log: string[] = [];
  const svc = {
    list: () => issues,
    get: (id: string) => issues.find((i) => i.id === id),
    statuses: () => STATUSES,
    userName: () => "me",
    create: async (input: { title: string; type?: string; repo?: string; description?: string }, actor?: { agent?: boolean; author?: string }) => {
      expect(actor).toEqual({ agent: true, author: "retro" });
      const dup = issues.find((i) => i.title === input.title && i.type === input.type && i.repo === input.repo);
      if (dup) {
        log.push(`seen again ${dup.id}`);
        return dup;
      }
      const issue = { id: `T-${issues.length + 1}`, status: "Triage", tags: [], source: "agent:retro", feed: [], ...input } as unknown as Issue;
      issues.push(issue);
      return issue;
    },
    comment: async (id: string, body: string) => {
      log.push(`comment ${id}: ${body}`);
      return issues.find((i) => i.id === id)!;
    },
    update: async (id: string, patch: Partial<Issue>) => Object.assign(issues.find((i) => i.id === id)!, patch),
  } as unknown as TicketService;
  return { svc, issues, log };
}

const run = (n: number, start: string, extra: Partial<RunIndexEntry> = {}): RunIndexEntry => ({
  runId: `r-${n}`,
  sessionId: `s-${n}`,
  profile: "home",
  start,
  durationMs: 1,
  costUsd: 0,
  toolCalls: 0,
  errors: 0,
  denials: 0,
  repo: "kyle",
  ...extra,
});
const rec = (type: string, t: string, extra: Record<string, unknown> = {}): DerivedRecord => ({ type, t, ...extra });

function logsOf(runs: RunIndexEntry[], records: Record<string, DerivedRecord[]>): LogReader & { calls: number } {
  const reader = {
    calls: 0,
    runs: async () => runs,
    records: async function* (id: string) {
      for (const r of records[id] ?? []) yield r;
    },
  };
  return reader;
}

const ctx: TemplateContext = {
  claudeHome: path.join("X", "claude"),
  repoPath: () => undefined,
  readFile: () => undefined,
};

/** n runs (3 sessions) each with a denial of `rm <path>` and a distinct error. */
function fixture(count: number, startDay = 1) {
  const runs: RunIndexEntry[] = [];
  const records: Record<string, DerivedRecord[]> = {};
  for (let i = 0; i < count; i++) {
    const t = `2026-11-${String(startDay + i).padStart(2, "0")}T10:00:00Z`;
    runs.push(run(startDay * 100 + i, t));
    records[`r-${startDay * 100 + i}`] = [
      rec("permission_denied", t, { tool: "Bash", pattern: "rm <path>" }),
      rec("error", t, { tool: "Bash", sigText: `boom ${i % 7 === 99 ? "x" : "same"}` }),
    ];
  }
  return { runs, records };
}

describe("performRetro", () => {
  const cfg = resolveRetroConfig({});
  const common = (tickets: TicketService, logs: LogReader, stateFile: string, maxTickets = 5, now = () => new Date("2026-12-01T00:00:00Z")) => ({
    logs,
    tickets,
    config: cfg,
    settings: { ...DEFAULT_RETRO_SETTINGS, maxTickets },
    ctx,
    profiles: ["home" as const],
    stateFile: () => stateFile,
    now,
  });

  it("creates triage tickets with evidence, advances the watermark, and a second retro adds only dedupe comments", async () => {
    const { runs, records } = fixture(4);
    const { svc, issues, log } = fakeTickets();
    const stateFile = path.join(root, "retro.json");
    const r1 = await performRetro(common(svc, logsOf(runs, records), stateFile));
    expect(r1.created.map((c) => c.type).sort()).toEqual(["finding", "proposal"]);
    expect(issues).toHaveLength(2);
    const prop = issues.find((i) => i.type === "proposal")!;
    expect(prop.description).toContain("Signature: `perm:Bash:rm <path>`");
    expect(prop.description).toContain("```diff");
    expect(prop.description).toContain("`kh logs show r-100`");
    expect(readRetroState(stateFile).watermark).toBe("2026-12-01T00:00:00.000Z");
    expect(readRetroState(stateFile).history[0]!.ticketIds).toHaveLength(2);

    // Same logs again but with a watermark reset: the repeats dedupe instead of creating tickets.
    updateRetroState(stateFile, (s) => ({ ...s, watermark: undefined }));
    const r2 = await performRetro(common(svc, logsOf(runs, records), stateFile));
    expect(r2.created).toEqual([]);
    expect(r2.seenAgain).toHaveLength(2);
    expect(issues).toHaveLength(2);
    expect(log.filter((l) => l.startsWith("seen again"))).toHaveLength(2);
  });

  it("creates at most maxTickets, highest count first", async () => {
    const runs: RunIndexEntry[] = [];
    const records: Record<string, DerivedRecord[]> = {};
    for (let i = 0; i < 6; i++) {
      const t = `2026-11-0${i + 1}T10:00:00Z`;
      runs.push(run(i, t));
      records[`r-${i}`] = [
        rec("error", t, { tool: "Bash", sigText: "alpha" }),
        rec("error", t, { tool: "Bash", sigText: "beta" }),
        rec("error", t, { tool: "Bash", sigText: "gamma" }),
        ...(i < 5 ? [rec("error", t, { tool: "Bash", sigText: "delta" })] : []),
      ];
    }
    const { svc, issues } = fakeTickets();
    const r = await performRetro(common(svc, logsOf(runs, records), path.join(root, "retro.json"), 2));
    expect(issues).toHaveLength(2);
    expect(r.skipped).toHaveLength(2);
    expect(r.skipped[0]).toContain("over the 2-ticket cap");
    expect(r.clusters).toBe(4);
  });

  it("makes no LLM or network call with default settings", async () => {
    const { runs, records } = fixture(4);
    const { svc } = fakeTickets();
    const runner = vi.fn<LlmRunner["run"]>();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await performRetro(common(svc, logsOf(runs, records), path.join(root, "retro.json")));
    const service = createRetroService({
      tickets: () => svc,
      logs: () => logsOf(runs, records),
      rawSettings: () => undefined,
      repos: () => ({}),
      ctx,
      runner: () => ({ run: runner }),
      stateFile: () => path.join(root, "retro2.json"),
    });
    await service.perform();
    expect(runner).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("passes the ticketId -> type map to detect (outliers)", async () => {
    const runs: RunIndexEntry[] = [];
    for (let i = 0; i < 20; i++) runs.push(run(i, `2026-11-${String(i + 1).padStart(2, "0")}T10:00:00Z`, { ticketId: "B-1", costUsd: i < 18 ? 1 : 50, durationMs: 1000 }));
    const { svc, issues } = fakeTickets();
    issues.push({ id: "B-1", type: "bug", status: "Todo", tags: [], title: "seed" } as unknown as Issue);
    expect(effectiveType(issues[0]!)).toBe("bug");
    const r = await performRetro({ ...common(svc, logsOf(runs, {}), path.join(root, "retro.json")), config: resolveRetroConfig({ minOccurrences: 2 }) });
    expect(r.created.map((c) => c.title)).toContain("Outlier cost for bug tickets");
  });
});

describe("recurrence", () => {
  const sig = (signature: string, t: string): Signal => ({ kind: "permission_denied", signature, runId: "r", sessionId: "s", t });
  const applied = { signature: "perm:Bash:rm <path>", appliedAt: "2026-11-05T00:00:00Z", ticketId: "T-1", quietRetros: 0 };

  it("recurred: >= minOccurrences after apply (pure)", () => {
    const signals = [sig(applied.signature, "2026-11-04T00:00:00Z"), ...["06", "07", "08"].map((d) => sig(applied.signature, `2026-11-${d}T00:00:00Z`))];
    const { verdicts } = checkRecurrence([applied], signals, 3);
    expect(verdicts).toMatchObject([{ kind: "recurred", count: 3 }]);
  });

  it("two fixture retros: Recurred path comments and files a finding", async () => {
    const { svc, issues, log } = fakeTickets();
    issues.push({ id: "T-1", type: "proposal", status: "Todo", tags: ["applied"], title: "Allow rm" } as unknown as Issue);
    const stateFile = path.join(root, "retro.json");
    updateRetroState(stateFile, (s) => ({ ...s, applied: [{ ...applied, appliedAt: "2026-10-30T00:00:00Z" }] }));
    const { runs, records } = fixture(4);
    const cfg = { ...DEFAULT_RETRO_SETTINGS };
    const deps = { logs: logsOf(runs, records), tickets: svc, config: resolveRetroConfig({}), settings: cfg, ctx, profiles: ["home" as const], stateFile: () => stateFile };
    const r = await performRetro(deps);
    expect(r.recurred).toEqual(["T-1"]);
    expect(log).toContain("comment T-1: Recurred 4× since apply");
    expect(issues.some((i) => i.title === "Proposal T-1 did not resolve perm:Bash:rm <path>" && i.type === "finding")).toBe(true);
  });

  it("two fixture retros: quiet twice -> Resolved exactly once", async () => {
    const { svc, issues, log } = fakeTickets();
    issues.push({ id: "T-1", type: "proposal", status: "Todo", tags: ["applied"], title: "Allow rm" } as unknown as Issue);
    const stateFile = path.join(root, "retro.json");
    updateRetroState(stateFile, (s) => ({ ...s, applied: [applied] }));
    const deps = { logs: logsOf([], {}), tickets: svc, config: resolveRetroConfig({}), settings: { ...DEFAULT_RETRO_SETTINGS }, ctx, profiles: ["home" as const], stateFile: () => stateFile };
    await performRetro(deps);
    expect(readRetroState(stateFile).applied[0]).toMatchObject({ quietRetros: 1 });
    expect(log).toEqual([]);
    await performRetro(deps);
    expect(log).toEqual(["comment T-1: Resolved"]);
    expect(readRetroState(stateFile).applied[0]).toMatchObject({ resolved: true });
    await performRetro(deps);
    expect(log).toEqual(["comment T-1: Resolved"]);
  });
});

describe("draft rule (opt-in LLM)", () => {
  const description = withDiff("body\n\nTarget: X\n\n## Evidence\n\nSignature: `corr:Bash:git push`\nSeen 5x across 3 sessions (2026-11-01 to 2026-11-05).\n\nRuns:\n- `kh logs show r-1`", undefined);
  const baseDeps = (over: Partial<Parameters<typeof draftRule>[0]> = {}) => {
    const run = vi.fn<LlmRunner["run"]>(async () => ({ text: "- Always run tests before git push.\nmore", costUsd: 0.1 }));
    const make = vi.fn(() => ({ run }));
    return {
      run,
      make,
      deps: {
        settings: () => ({ ...DEFAULT_RETRO_SETTINGS, allowDraftRule: true }),
        runner: make,
        stateFile: path.join(root, "retro.json"),
        ctx,
        excerpts: async () => ["use a token sk-abcdefghijklmnopqrstuvwxyz123456 here"],
        now: () => new Date(2026, 10, 21, 12),
        ...over,
      } satisfies Parameters<typeof draftRule>[0],
    };
  };

  it("is refused, without building a runner, when allowDraftRule is off", async () => {
    const { deps, make } = baseDeps({ settings: () => resolveRetroSettings({}) });
    const r = await draftRule(deps, { description });
    expect(r.ok).toBe(false);
    expect(make).not.toHaveBeenCalled();
  });

  it("button gate: canDraft is false by default and true only for corr findings when on", () => {
    const { svc, issues } = fakeTickets();
    issues.push({ id: "T-1", type: "finding", status: "Triage", tags: [], description } as unknown as Issue);
    const mk = (raw: unknown) => createRetroService({ tickets: () => svc, logs: () => undefined, rawSettings: () => raw, repos: () => ({}), ctx, runner: () => ({ run: vi.fn() }) });
    expect(mk(undefined).canDraft("T-1")).toBe(false);
    expect(mk({ allowDraftRule: true }).canDraft("T-1")).toBe(true);
    issues[0]!.description = description.replace("corr:", "err:");
    expect(mk({ allowDraftRule: true }).canDraft("T-1")).toBe(false);
  });

  it("drafts a one-line rule diff, redacts excerpts and records spend; the daily cap is enforced", async () => {
    const { deps, run } = baseDeps({ settings: () => ({ ...DEFAULT_RETRO_SETTINGS, allowDraftRule: true, dailyCapUsd: 0.15 }) });
    const r1 = await draftRule(deps, { description });
    expect(r1).toMatchObject({ ok: true, rule: "Always run tests before git push." });
    if (r1.ok) expect(r1.diff).toContain("+Always run tests before git push.");
    const prompt = run.mock.calls[0]![0];
    expect(prompt).toContain("corr:Bash:git push");
    expect(prompt).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(prompt.length).toBeLessThanOrEqual(8000);
    expect(readRetroState(deps.stateFile).llmSpend).toEqual({ day: "2026-11-21", usd: 0.1 });
    const r2 = await draftRule(deps, { description }); // spent 0.10 < 0.15
    expect(r2.ok).toBe(true);
    const r3 = await draftRule(deps, { description }); // spent 0.20 >= 0.15
    expect(r3).toMatchObject({ ok: false });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("confirm converts the finding into a proposal with the diff", async () => {
    const { svc, issues } = fakeTickets();
    issues.push({ id: "T-1", type: "finding", status: "Triage", tags: [], description } as unknown as Issue);
    const { deps } = baseDeps();
    const r = await draftRule(deps, { description });
    if (!r.ok) throw new Error("draft failed");
    await convertToProposal(svc, "T-1", r, "me");
    expect(issues[0]!.type).toBe("proposal");
    expect(issues[0]!.description).toContain("```diff");
    expect(issues[0]!.description).toContain("Target: X");
  });

  it("helpers", () => {
    expect(cleanRule("```\n- Do X.\n```")).toBe("Do X.");
    expect(buildPrompt("s", 1, 1, ["a", "b", "c", "d"]).match(/Excerpt/g)).toHaveLength(3);
  });
});

describe("work profile (ADR-0008)", () => {
  const SECRET = "ROTATE-THE-PROD-KEY-NOW";
  const workFixture = () => {
    const runs: RunIndexEntry[] = [];
    const records: Record<string, DerivedRecord[]> = {};
    for (let i = 0; i < 4; i++) {
      const t = `2026-11-0${i + 1}T10:00:00Z`;
      runs.push(run(500 + i, t, { profile: "work", repo: "acme" }));
      records[`r-${500 + i}`] = [
        rec("tool_call", t, { cmdNorm: "git push" }),
        // Derived records of a work run carry no excerpt; even if a legacy record did, no ticket may echo it.
        rec("user_correction", t, { afterTool: "Bash", excerpt: SECRET }),
      ];
    }
    return { runs, records };
  };

  it("retro tickets contain signatures and counts only, no excerpts", async () => {
    const { runs, records } = workFixture();
    const { svc, issues } = fakeTickets();
    const r = await performRetro({
      logs: logsOf(runs, records),
      tickets: svc,
      config: resolveRetroConfig({}),
      settings: { ...DEFAULT_RETRO_SETTINGS },
      ctx,
      profiles: ["work"],
      stateFile: () => path.join(root, "retro-work.json"),
      now: () => new Date("2026-12-01T00:00:00Z"),
    });
    expect(r.created.length).toBeGreaterThan(0);
    const corr = issues.find((i) => i.description?.includes("corr:Bash"));
    expect(corr).toBeDefined();
    expect(corr!.description).toMatch(/Seen 4x/);
    for (const i of issues) expect(`${i.title}\n${i.description}`).not.toContain(SECRET);
  });

  it("the draft-rule button is hidden and drafting refused in a work vault", async () => {
    const { svc, issues } = fakeTickets();
    issues.push({ id: "T-1", type: "finding", status: "Triage", tags: [], repo: "acme", description: "Signature: `corr:Bash:git push`" } as unknown as Issue);
    const mk = (vault: "home" | "work", repoProfile: "home" | "work") =>
      createRetroService({
        tickets: () => svc,
        logs: () => undefined,
        rawSettings: () => ({ allowDraftRule: true }),
        repos: () => ({ acme: { path: "C:/x", profile: repoProfile } }),
        ctx,
        runner: () => ({ run: vi.fn() }),
        vaultProfile: () => vault,
      });
    expect(mk("home", "home").canDraft("T-1")).toBe(true);
    expect(mk("work", "work").canDraft("T-1")).toBe(false);
    expect(mk("home", "work").canDraft("T-1")).toBe(false);
    expect(await mk("work", "work").draft("T-1")).toMatchObject({ ok: false });
  });

  it("retro status only reads the vault's profile", async () => {
    const runs = [run(1, "2026-11-01T10:00:00Z", { profile: "home" }), run(2, "2026-11-02T10:00:00Z", { profile: "work" })];
    const svc = createRetroService({
      tickets: () => undefined,
      logs: () => logsOf(runs, {}),
      rawSettings: () => undefined,
      repos: () => ({}),
      ctx,
      runner: () => ({ run: vi.fn() }),
      stateFile: (p) => path.join(root, `${p}.json`),
      vaultProfile: () => "work",
    });
    expect((await svc.status()).sessionsSince).toBe(1);
  });
});
