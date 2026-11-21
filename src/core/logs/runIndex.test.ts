import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { countSince, INDEX_FILE, mergeIndex, parseIndex, queryRuns, readIndex, spendByDay, summarizeRun, writeIndexAtomic } from "./runIndex";
import type { DerivedRecord, RunIndexEntry } from "./types";

const local = (y: number, m: number, d: number, h = 10): string => new Date(y, m - 1, d, h).toISOString();

const header = (runId: string, t: string, extra: Record<string, unknown> = {}): DerivedRecord => ({
  type: "run",
  runId,
  t,
  sessionId: runId.replace(/^s-/, ""),
  profile: "home",
  repo: "kyle-hub",
  ...extra,
});

const entry = (runId: string, start: string, costUsd = 0, extra: Partial<RunIndexEntry> = {}): RunIndexEntry => ({
  runId,
  sessionId: runId,
  profile: "home",
  start,
  durationMs: 0,
  costUsd,
  toolCalls: 0,
  errors: 0,
  denials: 0,
  ...extra,
});

describe("summarizeRun", () => {
  it("rolls up cost, counts and the last run_meta fields", () => {
    const recs: DerivedRecord[] = [
      header("s-a", "2026-11-21T10:00:00.000Z"),
      { type: "usage", runId: "s-a", t: "2026-11-21T10:00:05.000Z", model: "m1", costUsd: 0.5 },
      { type: "usage", runId: "s-a", t: "2026-11-21T10:01:00.000Z", model: "m2", costUsd: 0.25 },
      { type: "tool_call", runId: "s-a", t: "2026-11-21T10:01:01.000Z", tool: "Bash", ok: true },
      { type: "error", runId: "s-a", t: "2026-11-21T10:01:02.000Z", tool: "Bash" },
      { type: "permission_denied", runId: "s-a", t: "2026-11-21T10:01:03.000Z", tool: "Bash" },
      { type: "run_meta", runId: "s-a", t: "2026-11-21T10:02:00.000Z", ticketId: "LOCK-1", outcome: "in-review", summaryCommented: true },
    ];
    const e = summarizeRun("s-a", recs);
    expect(e).toMatchObject({
      runId: "s-a",
      sessionId: "a",
      profile: "home",
      repo: "kyle-hub",
      ticketId: "LOCK-1",
      model: "m2",
      start: "2026-11-21T10:00:00.000Z",
      end: "2026-11-21T10:02:00.000Z",
      durationMs: 120000,
      costUsd: 0.75,
      toolCalls: 1,
      errors: 1,
      denials: 1,
      outcome: "in-review",
      summaryCommented: true,
    });
  });

  it("returns undefined without a run header", () => {
    expect(summarizeRun("s-x", [{ type: "tool_call", t: "2026-11-21T10:00:00.000Z" }])).toBeUndefined();
  });
});

describe("mergeIndex", () => {
  it("appends a new run and replaces an updated one (later ingest), sorted by start", () => {
    const first = [entry("s-b", local(2026, 11, 21), 1)];
    const merged = mergeIndex(first, [entry("s-a", local(2026, 11, 20), 2), entry("s-b", local(2026, 11, 21), 3)]);
    expect(merged.map((e) => e.runId)).toEqual(["s-a", "s-b"]);
    expect(merged.find((e) => e.runId === "s-b")?.costUsd).toBe(3);
    expect(merged).toHaveLength(2);
  });
});

describe("index file", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kh-index-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes atomically: temp file is renamed away and the result round-trips", () => {
    writeIndexAtomic(dir, [entry("s-a", local(2026, 11, 21)), entry("s-b", local(2026, 11, 22))]);
    expect(fs.existsSync(path.join(dir, `${INDEX_FILE}.tmp`))).toBe(false);
    const back = readIndex(dir);
    expect(back.map((e) => e.runId)).toEqual(["s-a", "s-b"]);
    writeIndexAtomic(dir, []);
    expect(fs.readFileSync(path.join(dir, INDEX_FILE), "utf8")).toBe("");
  });

  it("returns [] when no index exists and skips torn lines", () => {
    expect(readIndex(dir)).toEqual([]);
    expect(parseIndex(`${JSON.stringify(entry("s-a", local(2026, 11, 21)))}\n{"runId":\n`)).toHaveLength(1);
  });
});

describe("queries", () => {
  const entries: RunIndexEntry[] = [
    entry("s-1", local(2026, 11, 18), 1, { ticketId: "LOCK-1", repo: "kyle-hub" }),
    entry("s-2", local(2026, 11, 20), 2, { ticketId: "LOCK-2", repo: "kyle-hub" }),
    entry("s-3", local(2026, 11, 21), 4, { repo: "other" }),
  ];

  it("filters by since, ticketId and repo; newest first; limit", () => {
    expect(queryRuns(entries).map((e) => e.runId)).toEqual(["s-3", "s-2", "s-1"]);
    expect(queryRuns(entries, { since: local(2026, 11, 20, 0) }).map((e) => e.runId)).toEqual(["s-3", "s-2"]);
    expect(queryRuns(entries, { ticketId: "LOCK-1" }).map((e) => e.runId)).toEqual(["s-1"]);
    expect(queryRuns(entries, { repo: "other" }).map((e) => e.runId)).toEqual(["s-3"]);
    expect(queryRuns(entries, { limit: 2 }).map((e) => e.runId)).toEqual(["s-3", "s-2"]);
    expect(queryRuns(entries, { limit: 0 })).toEqual([]);
  });

  it("countSince counts runs starting at or after the timestamp", () => {
    expect(countSince(entries, local(2026, 11, 20, 0))).toBe(2);
    expect(countSince(entries, local(2026, 12, 1))).toBe(0);
  });

  it("spendByDay zero-fills a fixed window ending today (fake clock)", () => {
    const now = new Date(2026, 10, 21, 12);
    const spend = spendByDay(entries, 3, now);
    expect(spend).toEqual([
      { day: "2026-11-19", costUsd: 0 },
      { day: "2026-11-20", costUsd: 2 },
      { day: "2026-11-21", costUsd: 4 },
    ]);
  });
});
