import { describe, expect, it } from "vitest";
import { computeGaps, linkName, undoneEditsByPath, type GapsInput, type NoteFact } from "./gaps";

const NOW = new Date("2026-06-01T00:00:00Z");
const day = (n: number): number => NOW.getTime() - n * 86_400_000;
const note = (path: string, o: Partial<NoteFact> = {}): NoteFact => ({ path, words: 100, mtimeMs: day(1), links: [], ...o });
const input = (o: Partial<GapsInput>): GapsInput => ({ now: NOW, notes: [], reads: [], writes: [], searches: [], agentMs: 0, ...o });

describe("computeGaps", () => {
  it("uses the later of mtime and reviewed for age, and sorts worst first", () => {
    const r = computeGaps(input({ notes: [note("a.md", { mtimeMs: day(200), reviewedMs: day(2) }), note("b.md", { mtimeMs: day(200) })] }));
    expect(r.grades.map((g) => g.path)).toEqual(["b.md", "a.md"]);
    expect(r.grades[1]!.ageDays).toBe(2);
    expect(r.summary.byGrade.A).toBe(1);
    expect(r.version).toBe(1);
  });
  it("counts the worst single-session read count and ignores unknown paths", () => {
    const reads = [1, 2, 3].map(() => ({ path: "a.md", sessionId: "s1" })).concat([{ path: "a.md", sessionId: "s2" }, { path: "gone.md", sessionId: "s1" }]);
    const r = computeGaps(input({ notes: [note("a.md")], reads }));
    expect(r.grades[0]!.maxReadsInSession).toBe(3);
    expect(r.grades[0]!.reasons).toContain("re-read 3");
  });
  it("counts empty searches in the same folder only, never unknown hits", () => {
    const r = computeGaps(input({
      notes: [note("Brain/a.md"), note("Other/b.md")],
      searches: [{ root: "Brain", hits: 0 }, { root: "Brain", hits: 3 }, { root: "Brain" }],
    }));
    expect(r.grades.find((g) => g.path === "Brain/a.md")!.emptySearchesNearby).toBe(1);
    expect(r.grades.find((g) => g.path === "Other/b.md")!.emptySearchesNearby).toBe(0);
  });
  it("ranks empty searches by total agent time", () => {
    const r = computeGaps(input({
      searches: [
        { root: ".", pattern: "quick", hits: 0, durationMs: 100 },
        { root: ".", pattern: "slow", hits: 0, durationMs: 5000 },
        { root: ".", pattern: "quick", hits: 0, durationMs: 100 },
        { root: ".", pattern: "found", hits: 2, durationMs: 9000 },
      ],
    }));
    expect(r.emptySearches.map((e) => [e.pattern, e.count, e.totalMs])).toEqual([["slow", 1, 5000], ["quick", 2, 200]]);
  });
  it("finds missing notes only when agents read the linking note or searched for the name", () => {
    const r = computeGaps(input({
      notes: [note("a.md", { links: ["Real", "Ghost|alias", "Unread#h"] }), note("Real.md"), note("b.md", { links: ["Unread"] })],
      reads: [{ path: "a.md", sessionId: "s" }, { path: "a.md", sessionId: "s" }],
      searches: [{ root: ".", pattern: "ghost", hits: 0 }],
    }));
    expect(r.missingNotes).toEqual([
      { target: "Ghost", linkedFrom: ["a.md"], reads: 2, emptySearches: 1 },
      { target: "Unread", linkedFrom: ["a.md", "b.md"], reads: 2, emptySearches: 0 },
    ]);
  });
  it("computes the search share of agent time", () => {
    const r = computeGaps(input({ searches: [{ root: ".", durationMs: 250 }, { root: ".", hits: 1, durationMs: 250 }], agentMs: 2000 }));
    expect(r.searchTime).toEqual({ searchMs: 500, agentMs: 2000, share: 0.25 });
    expect(computeGaps(input({})).searchTime.share).toBe(0);
  });
  it("flags folders whose notes run large, needing the minimum note count", () => {
    const big = (p: string): NoteFact => note(p, { words: 800 });
    const r = computeGaps(input({ notes: [big("L/1.md"), big("L/2.md"), big("L/3.md"), big("Two/1.md"), big("Two/2.md"), note("S/1.md"), note("S/2.md"), note("S/3.md")] }));
    expect(r.largeFolders).toEqual([{ folder: "L", notes: 3, avgWords: 800 }]);
  });
  it("carries the grading warning", () => {
    expect(computeGaps(input({ warning: "w" })).warning).toBe("w");
  });
});

describe("undoneEditsByPath", () => {
  const w = (t: string, before: string | undefined, after: string | undefined, sessionId = "s") => ({ path: "a.md", sessionId, t, ...(before ? { before } : {}), ...(after ? { after } : {}) });
  it("counts an Edit that restores the earlier text", () => {
    expect(undoneEditsByPath([w("1", "h0", "h1"), w("2", "h1", "h0")]).get("a.md")).toBe(1);
  });
  it("counts a Write that restores an earlier non-adjacent content hash", () => {
    expect(undoneEditsByPath([w("1", undefined, "h1"), w("2", undefined, "h2"), w("3", undefined, "h1")]).get("a.md")).toBe(1);
  });
  it("ignores repeated identical writes, other sessions and ordinary edits", () => {
    expect(undoneEditsByPath([w("1", undefined, "h1"), w("2", undefined, "h1")]).size).toBe(0);
    expect(undoneEditsByPath([w("1", "h0", "h1", "s1"), w("2", "h1", "h0", "s2")]).size).toBe(0);
    expect(undoneEditsByPath([w("1", "h0", "h1"), w("2", "h1", "h2")]).size).toBe(0);
  });
});

describe("linkName", () => {
  it("drops alias, heading, folder and extension", () => {
    expect(linkName("Folder/Note.md#H|alias")).toBe("Note");
  });
});
