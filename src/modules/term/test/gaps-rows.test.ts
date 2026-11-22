import { describe, expect, it } from "vitest";
import { gapRows } from "../src/gapsRows";
import type { GapsReport, GradedNote } from "../../../core/domain/gaps";

const note = (path: string, score: number, grade: GradedNote["grade"]): GradedNote => ({
  path, grade, score, reasons: `${grade} ${score}: 1,900 words, not reviewed for 140 days`,
  words: 1900, ageDays: 140, maxReadsInSession: 0, undoneEdits: 0, emptySearchesNearby: 0,
});

const report = (grades: GradedNote[]): GapsReport => ({
  version: 1, generatedAt: "2026-11-22T00:00:00Z", windowDays: 30, grades,
  summary: { notes: grades.length, byGrade: { A: 0, B: 0, C: 0, D: 0, F: 0 } },
  emptySearches: [], missingNotes: [],
  searchTime: { searchMs: 0, readMs: 0, lookupMs: 0, agentMs: 0, share: 0 }, largeFolders: [],
});

describe("gapRows", () => {
  it("keeps notes under the cutoff, worst first, with a clean name and reason", () => {
    const rows = gapRows(report([note("a/Ok.md", 85, "B"), note("Notes/Bad.md", 42, "F"), note("c/Mid.md", 65, "D")]));
    expect(rows.map((r) => r.name)).toEqual(["Bad", "Mid"]);
    expect(rows[0]).toEqual({ path: "Notes/Bad.md", name: "Bad", grade: "F", reason: "1,900 words, not reviewed for 140 days" });
  });

  it("honours a custom cutoff and returns nothing when all notes pass", () => {
    const r = report([note("x.md", 75, "C")]);
    expect(gapRows(r)).toEqual([]);
    expect(gapRows(r, 80)).toHaveLength(1);
  });
});
