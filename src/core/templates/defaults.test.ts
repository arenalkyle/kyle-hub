import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintDoc } from "../brain/lint";
import { runChecks } from "../brain/checks";
import { gradeNote } from "../domain/grading";
import { TEMPLATE_DEFAULTS, TEMPLATE_IDS } from "./index";

const NOW = Date.parse("2026-11-22T00:00:00Z");
const DAY = 86_400_000;
const FIXTURES = path.join(__dirname, "..", "..", "..", "test", "fixtures", "templates");
const words = (text: string): number => text.split(/\s+/).filter(Boolean).length;

describe.each(TEMPLATE_IDS)("template %s", (id) => {
  it("ships with reviewed frontmatter and the {{date}} placeholder", () => {
    expect(TEMPLATE_DEFAULTS[id]).toMatch(/^---\n[\s\S]*?\nreviewed: \{\{date\}\}\n[\s\S]*?---\n/);
  });

  it("is under 500 words", () => {
    expect(words(TEMPLATE_DEFAULTS[id])).toBeLessThan(500);
  });

  it("has a filled example under 500 words that grades A", () => {
    const text = fs.readFileSync(path.join(FIXTURES, `${id}.md`), "utf8");
    const reviewed = /^reviewed: (\d{4}-\d{2}-\d{2})$/m.exec(text)?.[1];
    expect(reviewed).toBeDefined();
    const n = words(text);
    expect(n).toBeLessThan(500);
    const ageDays = Math.floor((NOW - Date.parse(`${reviewed}T00:00:00Z`)) / DAY);
    const result = gradeNote({ words: n, ageDays, maxReadsInSession: 0, undoneEdits: 0, emptySearchesNearby: 0 });
    expect(result.grade).toBe("A");
  });

  it("filled example lints with no errors under Brain/", () => {
    const text = fs.readFileSync(path.join(FIXTURES, `${id}.md`), "utf8");
    expect(lintDoc(`Brain/${id}/x.md`, text).filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("review-overdue for new doctypes", () => {
  const run = (type: "reminder" | "ticket", reviewed: string) =>
    runChecks({ docs: [{ path: "Brain/x.md", type, text: "", reviewed }], now: new Date("2026-11-21T12:00:00Z"), exists: () => true, mentions: () => true, ignoreSymbols: [] }).filter((f) => f.check === "review-overdue");
  it("flags a reminder at 8 days, not at 6", () => {
    expect(run("reminder", "2026-11-13")).toHaveLength(1);
    expect(run("reminder", "2026-11-15")).toHaveLength(0);
  });
  it("never flags a ticket", () => {
    expect(run("ticket", "2020-01-01")).toHaveLength(0);
  });
});

it("linear-ticket-out uses Linear's collapsible Agent notes", () => {
  expect(TEMPLATE_DEFAULTS["linear-ticket-out"]).toMatch(/^\+\+\+ Agent notes$[\s\S]*^\+\+\+$/m);
});
