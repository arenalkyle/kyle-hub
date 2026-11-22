import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GAPS_VERSION, type GapsReport, type GradedNote } from "../../../core/domain/gaps";
import { DEFAULT_STATUSES } from "../../../core/domain/defaults";
import type { Issue } from "../../../core/domain/types";
import { countWaitingGapProposals, detectGapProposals, gapCandidates, gapMemory, GAP_THRESHOLDS } from "../retro/detectors/gaps";
import { parseGapsReport, readGapInputs } from "../retro/gapReport";
import { DEFAULT_GRADING } from "../../../core/domain/grading";

const note = (over: Partial<GradedNote>): GradedNote => ({
  path: "a.md",
  grade: "A",
  score: 95,
  reasons: "A 95",
  words: 200,
  ageDays: 1,
  maxReadsInSession: 0,
  undoneEdits: 0,
  emptySearchesNearby: 0,
  ...over,
});

const report = (over: Partial<GapsReport> = {}): GapsReport => ({
  version: GAPS_VERSION,
  generatedAt: "2026-11-22T00:00:00Z",
  windowDays: 30,
  grades: [],
  summary: { notes: 0, byGrade: { A: 0, B: 0, C: 0, D: 0, F: 0 } },
  emptySearches: [],
  missingNotes: [],
  searchTime: { searchMs: 0, readMs: 0, lookupMs: 0, agentMs: 0, share: 0 },
  largeFolders: [],
  ...over,
});

const ticket = (id: string, description: string, status = "Triage"): Issue =>
  ({ id, title: id, description, status, tags: [], priority: "none" }) as unknown as Issue;

describe("split_note", () => {
  it("proposes oversized and unkept notes (grading config limits), not small or recently kept ones", () => {
    const r = report({
      grades: [
        note({ path: "wiki/x.md", grade: "F", score: 41, words: 1900, ageDays: 40, reasons: "F 41" }),
        note({ path: "wiki/kept.md", grade: "A", score: 90, words: 1900, ageDays: 1 }),
        note({ path: "wiki/short.md", grade: "F", score: 30, words: 400, ageDays: 400 }),
        note({ path: "wiki/edge.md", grade: "C", score: 75, words: DEFAULT_GRADING.oversizedWords, ageDays: 400 }),
      ],
    });
    const splits = gapCandidates(r).filter((p) => p.kind === "split_note");
    expect(splits.map((p) => p.title)).toEqual(["Split `wiki/x.md` (1,900 words, F 41)"]);
    expect(splits[0]!.signature).toBe("gap:split_note:wiki/x.md");
    expect(splits[0]!.badness).toBe(1900);
  });

  it("takes its limits from the grading config", () => {
    const r = report({ grades: [note({ path: "wiki/m.md", grade: "A", score: 95, words: 600, ageDays: 35 })] });
    expect(gapCandidates(r).some((p) => p.kind === "split_note")).toBe(true);
    const strict = { ...DEFAULT_GRADING, oversizedWords: 700 };
    expect(gapCandidates(r, strict).some((p) => p.kind === "split_note")).toBe(false);
    const lenient = { ...DEFAULT_GRADING, unkeptDays: 60 };
    expect(gapCandidates(r, lenient).some((p) => p.kind === "split_note")).toBe(false);
  });
});

describe("write_note", () => {
  it("proposes a note for an empty search at or above the threshold, using the pattern", () => {
    const r = report({
      emptySearches: [
        { root: "wiki", pattern: "auth flow", count: 7, totalMs: 4 * 60_000 },
        { root: "wiki", count: GAP_THRESHOLDS.emptyMinCount - 1, totalMs: 1000 },
      ],
    });
    const writes = gapCandidates(r).filter((p) => p.kind === "write_note");
    expect(writes).toHaveLength(1);
    expect(writes[0]!.title).toBe("Write a note for `auth flow` (empty 7×, 4 min agent time)");
    expect(writes[0]!.badness).toBe(7);
  });
});

describe("review_note", () => {
  it("proposes a low-grade or stale note and scores badness as 100 - score", () => {
    const r = report({
      grades: [
        note({ path: "docs/y.md", grade: "C", score: 72, ageDays: 45, reasons: "C 72" }),
        note({ path: "docs/old.md", grade: "A", score: 95, ageDays: GAP_THRESHOLDS.staleDays }),
        note({ path: "docs/fresh.md", grade: "B", score: 85, ageDays: 3 }),
      ],
    });
    const reviews = gapCandidates(r).filter((p) => p.kind === "review_note");
    expect(reviews.map((p) => p.title)).toEqual(["Review `docs/y.md` (C 72, 45 days)", "Review `docs/old.md` (A 95, 90 days)"]);
    expect(reviews[0]!.badness).toBe(28);
    expect(reviews[1]!.badness).toBe(5);
  });
});

describe("split_folder", () => {
  it("proposes every large folder LOCK-68 reported, without re-thresholding", () => {
    const r = report({
      largeFolders: [
        { folder: "notes/deep", notes: 4, avgWords: 1234.4 },
        { folder: "notes/few", notes: 2, avgWords: 5000 },
      ],
    });
    const folders = gapCandidates(r).filter((p) => p.kind === "split_folder");
    expect(folders.map((p) => p.title)).toEqual(["Split folder `notes/deep` (4 notes, avg 1,234 words)", "Split folder `notes/few` (2 notes, avg 5,000 words)"]);
  });
});

describe("detectGapProposals", () => {
  const fixture = report({
    grades: [note({ path: "wiki/x.md", grade: "F", score: 41, words: 1900, ageDays: 40 }), note({ path: "docs/y.md", grade: "C", score: 72, ageDays: 45 })],
    emptySearches: [{ root: "wiki", pattern: "auth flow", count: 7, totalMs: 240_000 }],
    largeFolders: [{ folder: "notes/deep", notes: 4, avgWords: 1200 }],
  });

  it("is deterministic and orders by kind, then worst first", () => {
    const a = detectGapProposals(fixture, new Map());
    expect(a.map((p) => p.kind)).toEqual(["split_note", "write_note", "review_note", "review_note", "split_folder"]);
    expect(detectGapProposals(fixture, new Map())).toEqual(a);
  });

  it("returns nothing without a report", () => {
    expect(detectGapProposals(undefined, new Map())).toEqual([]);
  });

  it("caps the proposals per run", () => {
    expect(detectGapProposals(fixture, new Map(), DEFAULT_GRADING, 2)).toHaveLength(2);
  });

  it("does not re-propose a waiting gap, nor a closed one that is not strictly worse", () => {
    const memory = new Map([
      ["gap:split_note:wiki/x.md", { open: true as const }],
      ["gap:write_note:auth flow", { open: false as const, badness: 7 }],
      ["gap:review_note:docs/y.md", { open: false as const, badness: 28 }],
    ]);
    expect(detectGapProposals(fixture, memory).map((p) => p.signature)).toEqual(["gap:review_note:wiki/x.md", "gap:split_folder:notes/deep"]);
  });

  it("re-proposes a closed gap once it is strictly worse", () => {
    const worse = report({ grades: [note({ path: "wiki/x.md", grade: "F", score: 30, words: 2100, ageDays: 40 })] });
    const memory = new Map([["gap:split_note:wiki/x.md", { open: false as const, badness: 1900 }]]);
    expect(detectGapProposals(worse, memory).filter((p) => p.kind === "split_note").map((p) => p.title)).toEqual(["Split `wiki/x.md` (2,100 words, F 30)"]);
    const same = report({ grades: [note({ path: "wiki/x.md", grade: "F", score: 41, words: 1900, ageDays: 40 })] });
    expect(detectGapProposals(same, memory).filter((p) => p.kind === "split_note")).toEqual([]);
  });
});

describe("gap tickets", () => {
  const issues: Issue[] = [
    ticket("TIX-1", "Signature: `gap:split_note:wiki/x.md`\nBadness: 1900", "Canceled"),
    ticket("TIX-2", "Signature: `gap:review_note:docs/y.md`\nBadness: 28", "Done"),
    ticket("TIX-3", "Signature: `gap:write_note:auth flow`", "Canceled"),
    ticket("TIX-4", "Signature: `gap:split_folder:notes/deep`\nBadness: 1200", "Triage"),
    ticket("TIX-5", "Signature: `proposal:other`", "Triage"),
  ];

  it("reads closed badness and open state into memory", () => {
    const m = gapMemory(issues, DEFAULT_STATUSES);
    expect(m.get("gap:split_note:wiki/x.md")).toEqual({ open: false, badness: 1900 });
    expect(m.get("gap:review_note:docs/y.md")).toEqual({ open: false, badness: 28 });
    expect(m.get("gap:write_note:auth flow")).toEqual({ open: false, badness: Number.POSITIVE_INFINITY });
    expect(m.get("gap:split_folder:notes/deep")).toEqual({ open: true });
    expect(m.has("proposal:other")).toBe(false);
  });

  it("counts gap proposals in triage", () => {
    expect(countWaitingGapProposals(issues, DEFAULT_STATUSES)).toBe(1);
  });
});

describe("readGapInputs", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kh-gaps-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads a valid report and drops malformed rows", () => {
    const file = path.join(dir, ".kyle-hub", "gaps", "latest.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const raw = { ...report(), grades: [{ path: "a.md", grade: "F", score: 1, words: 1, ageDays: 1 }, { path: "bad.md", grade: "Z" }] };
    fs.writeFileSync(file, JSON.stringify(raw));
    expect(readGapInputs(dir)?.report.grades.map((g) => g.path)).toEqual(["a.md"]);
    expect(readGapInputs(dir)?.grading).toEqual(DEFAULT_GRADING);
    fs.writeFileSync(path.join(dir, ".kyle-hub", "grading.json"), JSON.stringify({ oversizedWords: 800 }));
    expect(readGapInputs(dir)?.grading.oversizedWords).toBe(800);
  });

  it("treats missing, invalid and wrong-version files as no report", () => {
    expect(readGapInputs(dir)).toBeUndefined();
    const file = path.join(dir, ".kyle-hub", "gaps", "latest.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{not json");
    expect(readGapInputs(dir)).toBeUndefined();
    expect(parseGapsReport({ version: 2, grades: [] })).toBeUndefined();
    expect(parseGapsReport(null)).toBeUndefined();
  });
});
