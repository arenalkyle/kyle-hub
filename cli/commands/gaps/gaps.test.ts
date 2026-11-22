import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GapsReport } from "../../../src/core/domain/gaps";
import { ensureGapsIgnored } from "../../../src/core/gaps/gather";
import { EXIT, type Io } from "../tickets/cli";
import { runGaps } from "./cli";
import { runMaintain } from "../ops/cli";

const NOW = new Date("2026-06-01T12:00:00Z");
let tmp: string;
let vault: string;
let lines: string[];

const write = (rel: string, text: string, ageDays = 1): void => {
  const f = path.join(vault, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
  const t = new Date(NOW.getTime() - ageDays * 86_400_000);
  fs.utimesSync(f, t, t);
};

const spool = (profile: string, recs: unknown[]): void => {
  const dir = path.join(tmp, "local", "kyle-hub", profile, "hooks");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "2026-05-30.jsonl"), recs.map((r) => JSON.stringify(r)).join("\n") + "\n");
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kh-gaps-"));
  vault = path.join(tmp, "vault");
  fs.mkdirSync(vault, { recursive: true });
  lines = [];
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const io = (): Io => ({
  cwd: tmp,
  env: { LOCALAPPDATA: path.join(tmp, "local"), USERPROFILE: path.join(tmp, "home"), CLAUDE_CONFIG_DIR: path.join(tmp, "claude"), KYLE_HUB_VAULTS: vault },
  stdin: () => "",
  out: (s) => lines.push(s),
  err: (s) => lines.push(s),
  now: () => NOW,
});

const read = (): GapsReport => JSON.parse(fs.readFileSync(path.join(vault, ".kyle-hub", "gaps", "latest.json"), "utf8")) as GapsReport;

describe("kh gaps", () => {
  it("grades the vault from spool reads and writes, writes latest.json and ignores it in git", async () => {
    write("Brain/big.md", `---\nreviewed: 2025-01-01\n---\n${"word ".repeat(1900)}\n[[Ghost]]`, 400);
    write("Brain/small.md", "short note");
    const at = (n: number): string => `2026-05-30T10:0${n}:00.000Z`;
    const reads = Array.from({ length: 9 }, (_, n) => ({ t: at(n), sessionId: "s1", name: "PostToolUse", access: { kind: "read", path: "Brain/big.md" } }));
    spool("home", [
      ...reads,
      { t: at(0), sessionId: "s1", name: "PostToolUse", access: { kind: "write", path: "Brain/small.md", before: "h0", after: "h1" } },
      { t: at(1), sessionId: "s1", name: "PostToolUse", access: { kind: "write", path: "Brain/small.md", before: "h1", after: "h0" } },
    ]);
    fs.writeFileSync(path.join(vault, ".gitignore"), "node_modules");
    expect(await runGaps([], io())).toBe(EXIT.ok);
    const r = read();
    const big = r.grades.find((g) => g.path === "Brain/big.md")!;
    expect(big.grade).toBe("F");
    expect(big.reasons).toMatch(/^F \d+: 1,901 words, not reviewed for \d+ days, re-read 9×$/);
    expect(r.grades.find((g) => g.path === "Brain/small.md")!.undoneEdits).toBe(1);
    expect(r.missingNotes[0]).toMatchObject({ target: "Ghost", reads: 9 });
    expect(fs.readFileSync(path.join(vault, ".gitignore"), "utf8")).toBe("node_modules\n.kyle-hub/gaps/\n");
    await runGaps([], io());
    expect(fs.readFileSync(path.join(vault, ".gitignore"), "utf8")).toBe("node_modules\n.kyle-hub/gaps/\n");
  });

  it("reads empty searches from run records and ranks them by time", async () => {
    write("Brain/a.md", "x");
    const dir = path.join(tmp, "local", "kyle-hub", "home");
    fs.mkdirSync(path.join(dir, "runs"), { recursive: true });
    const entry = { runId: "r1", sessionId: "s1", profile: "home", start: "2026-05-30T10:00:00.000Z", durationMs: 10_000, costUsd: 0, toolCalls: 2, errors: 0, denials: 0 };
    fs.writeFileSync(path.join(dir, "index.jsonl"), `${JSON.stringify(entry)}\n`);
    fs.writeFileSync(
      path.join(dir, "runs", "r1.jsonl"),
      [
        { type: "search", t: "2026-05-30T10:00:01.000Z", tool: "Grep", root: "Brain", pattern: "nothing", hits: 0, durationMs: 2000 },
        { type: "search", t: "2026-05-30T10:00:05.000Z", tool: "Grep", root: "Brain", pattern: "found", hits: 4, durationMs: 1000 },
        { type: "search", t: "2026-05-30T10:00:06.000Z", tool: "Glob", root: "Brain", pattern: "unknown", durationMs: 500 },
      ].map((x) => JSON.stringify(x)).join("\n") + "\n",
    );
    await runGaps([], io());
    const r = read();
    expect(r.emptySearches).toEqual([{ root: "Brain", pattern: "nothing", count: 1, totalMs: 2000 }]);
    expect(r.searchTime).toEqual({ searchMs: 3500, agentMs: 10_000, share: 0.35 });
    expect(r.grades[0]!.emptySearchesNearby).toBe(1);
  });

  it("falls back to defaults with a warning when grading.json is invalid, and honours overrides", async () => {
    write("a.md", "x");
    fs.mkdirSync(path.join(vault, ".kyle-hub"), { recursive: true });
    fs.writeFileSync(path.join(vault, ".kyle-hub", "grading.json"), "{ broken");
    await runGaps([], io());
    expect(read().warning).toMatch(/not valid JSON/);
    fs.writeFileSync(path.join(vault, ".kyle-hub", "grading.json"), JSON.stringify({ windowDays: 7 }));
    await runGaps([], io());
    expect(read().windowDays).toBe(7);
    expect(read().warning).toBeUndefined();
  });

  it("prints JSON and runs from kh maintain", async () => {
    write("a.md", "x");
    expect(await runGaps(["--json"], io())).toBe(EXIT.ok);
    expect((JSON.parse(lines.join("\n")) as GapsReport).version).toBe(1);
    lines.length = 0;
    await runMaintain(io());
    expect(lines.some((l) => l.startsWith("gaps: 1 notes graded"))).toBe(true);
  });
});

describe("ensureGapsIgnored", () => {
  it("creates the file, keeps CRLF content and is idempotent", () => {
    expect(ensureGapsIgnored(vault)).toBe(true);
    expect(fs.readFileSync(path.join(vault, ".gitignore"), "utf8")).toBe(".kyle-hub/gaps/\n");
    fs.writeFileSync(path.join(vault, ".gitignore"), "a\r\nb");
    expect(ensureGapsIgnored(vault)).toBe(true);
    expect(fs.readFileSync(path.join(vault, ".gitignore"), "utf8")).toBe("a\r\nb\r\n.kyle-hub/gaps/\r\n");
    expect(ensureGapsIgnored(vault)).toBe(false);
  });
});
