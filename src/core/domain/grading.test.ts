import { describe, expect, it } from "vitest";
import { DEFAULT_GRADING, gradeNote, gradeOf, parseGradingConfig, type NoteGradeInput } from "./grading";

const clean: NoteGradeInput = { words: 100, ageDays: 0, maxReadsInSession: 0, undoneEdits: 0, emptySearchesNearby: 0 };

describe("gradeOf boundaries", () => {
  it.each([[100, "A"], [90, "A"], [89, "B"], [80, "B"], [79, "C"], [70, "C"], [69, "D"], [60, "D"], [59, "F"], [0, "F"]])("%i is %s", (score, grade) => {
    expect(gradeOf(score)).toBe(grade);
  });
});

describe("gradeNote inputs", () => {
  it("a fresh small note is A 100 with no issues", () => {
    expect(gradeNote(clean)).toEqual({ grade: "A", score: 100, reasons: "A 100: no issues" });
  });
  it("age costs nothing inside the grace period and 0.1 per day beyond it, capped", () => {
    expect(gradeNote({ ...clean, ageDays: 30 }).score).toBe(100);
    expect(gradeNote({ ...clean, ageDays: 130 }).score).toBe(90);
    expect(gradeNote({ ...clean, ageDays: 130 }).reasons).toBe("A 90: not reviewed for 130 days");
    expect(gradeNote({ ...clean, ageDays: 5000 }).score).toBe(70);
  });
  it("re-reads start at the minimum, 3 points each", () => {
    expect(gradeNote({ ...clean, maxReadsInSession: 2 }).score).toBe(100);
    expect(gradeNote({ ...clean, maxReadsInSession: 3 }).score).toBe(97);
    expect(gradeNote({ ...clean, maxReadsInSession: 9 }).reasons).toBe("C 79: re-read 9×");
  });
  it("undone edits cost 8 each, capped at 24", () => {
    expect(gradeNote({ ...clean, undoneEdits: 1 })).toMatchObject({ score: 92, reasons: "A 92: 1 agent edit undone" });
    expect(gradeNote({ ...clean, undoneEdits: 9 }).score).toBe(76);
  });
  it("oversized needs both over 500 words and 30 days unkept", () => {
    expect(gradeNote({ ...clean, words: 2000, ageDays: 29 }).score).toBe(100);
    expect(gradeNote({ ...clean, words: 500, ageDays: 60 }).score).toBe(97);
    expect(gradeNote({ ...clean, words: 501, ageDays: 30 }).score).toBe(85);
    expect(gradeNote({ ...clean, words: 501, ageDays: 30 }).reasons).toBe("B 85: 501 words, not reviewed for 30 days");
  });
  it("nearby empty searches cost 2 each, capped at 10", () => {
    expect(gradeNote({ ...clean, emptySearchesNearby: 2 }).score).toBe(96);
    expect(gradeNote({ ...clean, emptySearchesNearby: 50 }).score).toBe(90);
  });
  it("combines inputs into a readable reason, never below 0", () => {
    const g = gradeNote({ words: 1900, ageDays: 140, maxReadsInSession: 9, undoneEdits: 0, emptySearchesNearby: 0 });
    expect(g.grade).toBe("F");
    expect(g.reasons).toBe(`F ${g.score}: 1,900 words, not reviewed for 140 days, re-read 9×`);
    expect(gradeNote({ words: 9000, ageDays: 9000, maxReadsInSession: 99, undoneEdits: 99, emptySearchesNearby: 99 }).score).toBeGreaterThanOrEqual(0);
  });
});

describe("parseGradingConfig", () => {
  it("returns defaults when there is no file", () => {
    expect(parseGradingConfig(undefined)).toEqual({ config: DEFAULT_GRADING });
  });
  it("overrides any key, deeply, and ignores bad values", () => {
    const { config, warning } = parseGradingConfig(JSON.stringify({ oversizedWords: 900, thresholds: { A: 95 }, weights: { undoneEach: 20, ageCap: "x" }, bogus: 1 }));
    expect(warning).toBeUndefined();
    expect(config.oversizedWords).toBe(900);
    expect(config.thresholds).toEqual({ ...DEFAULT_GRADING.thresholds, A: 95 });
    expect(config.weights.undoneEach).toBe(20);
    expect(config.weights.ageCap).toBe(DEFAULT_GRADING.weights.ageCap);
    expect(gradeNote({ ...clean, undoneEdits: 1 }, config).score).toBe(80);
  });
  it("falls back to defaults with a warning on invalid JSON or a non-object", () => {
    const bad = parseGradingConfig("{ nope");
    expect(bad.config).toEqual(DEFAULT_GRADING);
    expect(bad.warning).toMatch(/not valid JSON/);
    expect(parseGradingConfig("[1]").warning).toMatch(/object/);
  });
});
