import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GapsService } from "../../core";
import { GAPS_VERSION, type GapsReport, type GradedNote } from "../../core/domain/gaps";
import { createGapsService, readGapsReport } from "./gaps";
import { noteName, worstFirst } from "./gapsPanel";

const note = (p: string, score: number): GradedNote => ({
  path: p, grade: "F", score, reasons: "1,900 words", words: 1900, ageDays: 140, maxReadsInSession: 9, undoneEdits: 0, emptySearchesNearby: 0,
});
const report = (): GapsReport => ({
  version: GAPS_VERSION, generatedAt: "2026-11-22T00:00:00Z", windowDays: 30, grades: [note("a/x.md", 42)],
  summary: { notes: 1, byGrade: { A: 0, B: 0, C: 0, D: 0, F: 1 } }, emptySearches: [], missingNotes: [],
  searchTime: { searchMs: 0, readMs: 0, lookupMs: 0, agentMs: 0, share: 0 }, largeFolders: [],
});
const nextChange = (svc: GapsService): Promise<void> =>
  new Promise((resolve, reject) => {
    const off = svc.onChange(() => {
      clearTimeout(timer);
      off();
      resolve();
    });
    const timer = setTimeout(() => {
      off();
      reject(new Error("no change event"));
    }, 3000);
  });

let vault: string;
let disposers: Array<() => void> = [];

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "kh-gaps-"));
});

afterEach(() => {
  for (const d of disposers) d();
  disposers = [];
  fs.rmSync(vault, { recursive: true, force: true });
});

describe("readGapsReport", () => {
  it("returns undefined when missing or not a version-1 report", () => {
    expect(readGapsReport(vault)).toBeUndefined();
    const dir = path.join(vault, ".kyle-hub", "gaps");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify({ version: 2 }));
    expect(readGapsReport(vault)).toBeUndefined();
  });

  it("returns the parsed report", () => {
    const dir = path.join(vault, ".kyle-hub", "gaps");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(report()));
    expect(readGapsReport(vault)?.grades[0]?.path).toBe("a/x.md");
  });
});

describe("createGapsService", () => {
  it("fires onChange when the report file is written to an existing folder", async () => {
    const dir = path.join(vault, ".kyle-hub", "gaps");
    fs.mkdirSync(dir, { recursive: true });
    const gaps = createGapsService(vault);
    disposers.push(gaps.dispose);
    const changed = nextChange(gaps.service);
    fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(report()));
    await changed;
    expect(gaps.service.read()?.version).toBe(GAPS_VERSION);
  });

  it("fires onChange once the folder appears under a vault with no .kyle-hub", async () => {
    const gaps = createGapsService(vault);
    disposers.push(gaps.dispose);
    const changed = nextChange(gaps.service);
    const dir = path.join(vault, ".kyle-hub", "gaps");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(report()));
    await changed;
    expect(gaps.service.read()).toBeDefined();
  });

  it("reads undefined without a vault path and stops watching after dispose", () => {
    const gaps = createGapsService(undefined);
    expect(gaps.service.read()).toBeUndefined();
    gaps.dispose();
  });
});

describe("gaps panel helpers", () => {
  it("lists notes under the cutoff, worst first", () => {
    const rows = worstFirst([note("b.md", 65), note("a.md", 42), note("c.md", 70), note("d.md", 42)], 70);
    expect(rows.map((r) => r.path)).toEqual(["a.md", "d.md", "b.md"]);
  });

  it("names a note without folder or extension", () => {
    expect(noteName("Brain/notes/Deep Work.md")).toBe("Deep Work");
    expect(noteName("plain")).toBe("plain");
  });
});
