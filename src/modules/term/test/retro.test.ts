import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeSig } from "../../../core/logs/normalize";
import type { DerivedRecord, RunIndexEntry } from "../../../core/logs/types";
import { runRetro } from "../../../../cli/commands/retro/cli";
import { cluster } from "../retro/cluster";
import { detect } from "../retro/detect";
import { resolveRetroConfig } from "../retro/config";
import { maskSignature } from "../retro/normalize";
import { commitRetro, readRetroState, sessionsSinceRetro } from "../retro/state";
import type { DetectInput, RetroConfig } from "../retro/types";

const CFG: RetroConfig = resolveRetroConfig({});

const run = (runId: string, sessionId: string, start: string, extra: Partial<RunIndexEntry> = {}): RunIndexEntry => ({
  runId,
  sessionId,
  profile: "home",
  start,
  end: start,
  durationMs: 1000,
  costUsd: 0.1,
  toolCalls: 0,
  errors: 0,
  denials: 0,
  repo: "kyle",
  ticketId: "T-1",
  ...extra,
});

const rec = (type: string, t: string, extra: Record<string, unknown> = {}): DerivedRecord => ({ type, t, ...extra });

function input(runs: RunIndexEntry[], records: Record<string, DerivedRecord[]>, extra: Partial<DetectInput> = {}): DetectInput {
  return { runs, records: new Map(Object.entries(records)), config: CFG, ...extra };
}

describe("signal kinds (golden)", () => {
  const r = run("r1", "s1", "2026-11-01T10:00:00Z");
  const t = "2026-11-01T10:00:01Z";

  it("repeated_error masks path, number and hash", () => {
    const res = detect(input([r], { r1: [rec("error", t, { tool: "Bash", sigText: "failed at <path>:<num> commit deadbeef1" })] }));
    expect(res.signals.map((s) => [s.kind, s.signature])).toEqual([["repeated_error", "err:Bash:failed at <path>:<num> commit <hash>"]]);
  });

  it("permission_denied", () => {
    const res = detect(input([r], { r1: [rec("permission_denied", t, { tool: "Bash", pattern: "rm <path>" })] }));
    expect(res.signals.map((s) => [s.kind, s.signature])).toEqual([["permission_denied", "perm:Bash:rm <path>"]]);
  });

  it("command_sequence: 3- and 4-windows, ignore list dropped", () => {
    const cmd = (c: string) => rec("tool_call", t, { tool: "Bash", ok: true, cmdNorm: c });
    const res = detect(input([r], { r1: [cmd("npm test"), cmd("ls"), cmd("git add"), cmd("git commit"), cmd("git push")] }));
    expect(res.signals.map((s) => s.signature).sort()).toEqual([
      "seq:git add|git commit|git push",
      "seq:npm test|git add|git commit",
      "seq:npm test|git add|git commit|git push",
    ]);
  });

  it("command_sequence counts a repeated loop once per run", () => {
    const cmd = (c: string) => rec("tool_call", t, { tool: "Bash", ok: true, cmdNorm: c });
    const loop = ["a b", "c d", "e f", "a b", "c d", "e f"].map(cmd);
    const res = detect(input([r], { r1: loop }));
    expect(res.signals.filter((s) => s.signature === "seq:a b|c d|e f")).toHaveLength(1);
  });

  it("user_correction keys on last command, else file extension", () => {
    const res = detect(
      input([r], {
        r1: [
          rec("tool_call", t, { tool: "Bash", ok: true, cmdNorm: "npm test" }),
          rec("user_correction", t, { afterTool: "Bash" }),
          rec("file_write", t, { pathRel: "src/a.ts" }),
          rec("tool_call", t, { tool: "Edit", ok: true }),
          rec("interrupt", t, { afterTool: "Edit" }),
        ],
      }),
    );
    expect(res.signals.map((s) => s.signature)).toEqual(["corr:Bash:npm test", "corr:Edit:.ts"]);
  });

  it("startup_docs covers only the first N tool calls, once per file", () => {
    const calls = Array.from({ length: 8 }, () => rec("tool_call", t, { tool: "Bash", ok: true }));
    const res = detect(
      input([r], {
        r1: [rec("file_read", t, { pathRel: "README.md" }), rec("file_read", t, { pathRel: "README.md" }), ...calls, rec("file_read", t, { pathRel: "late.md" })],
      }),
    );
    expect(res.signals.map((s) => s.signature)).toEqual(["doc:kyle:README.md"]);
  });
});

describe("clustering thresholds", () => {
  const err = (t: string) => rec("error", t, { tool: "Bash", sigText: "boom" });
  const t = "2026-11-01T10:00:01Z";

  it("3 occurrences in 1 session is not a cluster", () => {
    const runs = [run("a", "s1", "2026-11-01T10:00:00Z"), run("b", "s1", "2026-11-01T11:00:00Z"), run("c", "s1", "2026-11-01T12:00:00Z")];
    expect(detect(input(runs, { a: [err(t)], b: [err(t)], c: [err(t)] })).clusters).toEqual([]);
  });

  it("3 occurrences across 2 sessions is a cluster", () => {
    const runs = [run("a", "s1", "2026-11-01T10:00:00Z"), run("b", "s1", "2026-11-01T11:00:00Z"), run("c", "s2", "2026-11-01T12:00:00Z")];
    const res = detect(input(runs, { a: [err(t)], b: [err(t)], c: [err(t)] }));
    expect(res.clusters).toHaveLength(1);
    expect(res.clusters[0]).toMatchObject({ signature: "err:Bash:boom", count: 3, sessions: ["s1", "s2"], runIds: ["a", "b", "c"], repo: "kyle" });
  });

  it("cluster lists at most 10 run ids", () => {
    const runs = Array.from({ length: 12 }, (_, i) => run(`r${i}`, `s${i % 2}`, `2026-11-01T10:${String(i).padStart(2, "0")}:00Z`));
    const records = Object.fromEntries(runs.map((x) => [x.runId, [err(t)]]));
    expect(detect(input(runs, records)).clusters[0]?.runIds).toHaveLength(10);
  });

  it("cluster() on no signals is empty", () => {
    expect(cluster([], CFG)).toEqual([]);
  });
});

describe("normalization", () => {
  it("errors differing only by path, number or hash share a signature", () => {
    const a = normalizeSig("Error: C:\\proj\\a.ts:12 at 2026-11-01T10:00:00Z commit 9f8e7d6c");
    const b = normalizeSig("Error: D:\\other\\b.ts:99 at 2026-11-02T11:11:11Z commit 1a2b3c4d");
    expect(maskSignature(a)).toBe(maskSignature(b));
    expect(maskSignature(a)).not.toBe(maskSignature(normalizeSig("Error: something else")));
  });
});

describe("outliers", () => {
  const runsOf = (n: number, costs: number[]) =>
    Array.from({ length: n }, (_, i) => run(`o${i}`, `s${i}`, `2026-11-01T10:${String(i).padStart(2, "0")}:00Z`, { costUsd: costs[i] ?? 0.1 }));
  const types = new Map([["T-1", "task"]]);

  it("needs at least 10 runs of a type", () => {
    const nine = runsOf(9, [5, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]);
    expect(detect(input(nine, {}, { ticketTypes: types })).signals.filter((s) => s.kind === "outlier")).toEqual([]);
  });

  it("flags a run above 2x p90 once there are 10 runs", () => {
    const ten = runsOf(10, [5, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]);
    const out = detect(input(ten, {}, { ticketTypes: types })).signals.filter((s) => s.kind === "outlier");
    expect(out.map((s) => [s.signature, s.runId])).toEqual([["out:task:cost", "o0"]]);
  });
});

describe("watermark", () => {
  it("ignores runs at or before the watermark", () => {
    const runs = [run("old", "s1", "2026-11-01T10:00:00Z"), run("edge", "s1", "2026-11-02T00:00:00Z"), run("new", "s1", "2026-11-03T00:00:00Z")];
    const cmd = ["a b", "c d", "e f"].map((c) => rec("tool_call", "x", { tool: "Bash", ok: true, cmdNorm: c }));
    const records = { old: cmd, edge: cmd, new: cmd };
    expect([...new Set(detect(input(runs, records, { watermark: "2026-11-02T00:00:00Z" })).signals.map((s) => s.runId))]).toEqual(["new"]);
    const later = detect(input(runs, records, { watermark: "2026-11-01T00:00:00Z" })).signals.map((s) => s.runId);
    expect([...new Set(later)].sort()).toEqual(["edge", "new", "old"]);
  });

  it("commitRetro advances the watermark and sessionsSinceRetro counts later runs", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kh-retro-"));
    try {
      const file = path.join(dir, "retro.json");
      const runs = [run("a", "s1", "2026-11-01T10:00:00Z"), run("b", "s2", "2026-11-05T10:00:00Z")];
      const state = commitRetro(file, detect(input(runs, {})), ["T-9"], new Date("2026-11-02T00:00:00Z"));
      expect(state.watermark).toBe("2026-11-02T00:00:00.000Z");
      expect(readRetroState(file)).toEqual(state);
      expect(sessionsSinceRetro(runs, state.watermark)).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("purity and dry run", () => {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

  it("retro/ imports no network or LLM client", () => {
    const dir = path.resolve(__dirname, "../retro");
    const banned = /^(node:)?(http|https|net|tls|dgram|dns|undici|axios|node-fetch|cross-fetch|obsidian)$|anthropic|openai/;
    for (const file of walk(dir).filter((f) => f.endsWith(".ts"))) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(/(?:from\s+|require\(|import\()\s*["']([^"']+)["']/g)) {
        expect(m[1], file).not.toMatch(banned);
      }
      expect(src, file).not.toMatch(/\bfetch\(/);
    }
  });

  describe("kh retro detect", () => {
    let root: string;
    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), "kh-retro-cli-"));
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it("prints clusters and leaves retro.json and the index untouched", async () => {
      const home = path.join(root, "kyle-hub", "home");
      fs.mkdirSync(path.join(home, "runs"), { recursive: true });
      const runs = [run("a", "s1", "2026-11-01T10:00:00Z"), run("b", "s1", "2026-11-01T11:00:00Z"), run("c", "s2", "2026-11-01T12:00:00Z")];
      const indexText = runs.map((x) => JSON.stringify(x)).join("\n") + "\n";
      fs.writeFileSync(path.join(home, "index.jsonl"), indexText);
      for (const x of runs) {
        fs.writeFileSync(path.join(home, "runs", `${x.runId}.jsonl`), JSON.stringify(rec("error", x.start, { tool: "Bash", sigText: "boom" })) + "\n");
      }
      const retroPath = path.join(home, "retro.json");
      const before = '{"history":[]}\n';
      fs.writeFileSync(retroPath, before);
      const out: string[] = [];
      const io = { cwd: root, env: { LOCALAPPDATA: root, USERPROFILE: root }, stdin: () => "", out: (s: string) => out.push(s), err: (s: string) => out.push(s), now: () => new Date() };
      expect(await runRetro(["detect", "--profile", "home", "--json"], io)).toBe(0);
      const parsed = JSON.parse(out.join("\n")) as Array<{ clusters: Array<{ signature: string }> }>;
      expect(parsed[0]?.clusters.map((c) => c.signature)).toEqual(["err:Bash:boom"]);
      expect(fs.readFileSync(retroPath, "utf8")).toBe(before);
      expect(fs.readFileSync(path.join(home, "index.jsonl"), "utf8")).toBe(indexText);
      expect(fs.existsSync(path.join(root, "kyle-hub", "work", "retro.json"))).toBe(false);
      const again: string[] = [];
      await runRetro(["detect", "--profile", "home", "--json"], { ...io, out: (s: string) => again.push(s) });
      expect(again.join("\n")).toBe(out.join("\n"));
    });
  });
});
