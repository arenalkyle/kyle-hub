import { describe, expect, it } from "vitest";
import { lintDoc } from "./lint";
import { inferDocType } from "./doctypes";

const FM = (doctype: string, extra = "") => `---\ndoctype: ${doctype}\naudience: human\nreviewed: 2026-11-01\n${extra}---\n`;
const errors = (issues: { severity: string; message: string }[]) => issues.filter((i) => i.severity === "error");

describe("lintDoc per doc type", () => {
  it("accepts a valid doc of each declared type", () => {
    const docs: Record<string, string> = {
      adr: `${FM("adr")}# Use X\n\nContext paragraph.\n`,
      glossary: `${FM("glossary")}# G\n\n## Language\n\n**Term**:\nDef.\n`,
      plan: `${FM("plan")}# Plan\n\nBody.\n`,
      status: `${FM("status")}# S\n\n_Last updated: 2026-11-20_\n\n## Done\n- a\n\n## In progress\n- b\n\n## Next\n- c\n`,
      runbook: `${FM("runbook")}# R\n\n## Steps\n1. go\n`,
      lesson: `${FM("lesson")}# L\n\n## Lesson\nText.\n`,
      overview: `${FM("overview")}# O\n\n## Summary\nText.\n`,
    };
    for (const [type, text] of Object.entries(docs)) {
      expect(errors(lintDoc(`Brain/${type}/x.md`, text)), type).toEqual([]);
    }
  });

  it("reports a missing required section as an error", () => {
    const issues = lintDoc("Brain/lesson/x.md", `${FM("lesson")}# L\n\nNo lesson heading.\n`);
    expect(errors(issues).map((i) => i.message)).toEqual(['missing section "## Lesson"']);
  });

  it("reports missing status sections and last-updated line", () => {
    const issues = errors(lintDoc("Brain/status/s.md", `${FM("status")}# S\n\n## Done\n`));
    const msgs = issues.map((i) => i.message);
    expect(msgs).toContain("missing last-updated date (e.g. _Last updated: YYYY-MM-DD_)");
    expect(msgs).toContain('missing status section "In progress"');
    expect(msgs).toContain('missing status section "Next"');
  });

  it("reports an ADR without a context paragraph", () => {
    expect(errors(lintDoc("Brain/adr/a.md", `${FM("adr")}# Only title\n`)).map((i) => i.message)).toEqual(["missing context paragraph after title"]);
  });

  it("reports a glossary without any term entry", () => {
    expect(errors(lintDoc("Brain/glossary/g.md", `${FM("glossary")}# G\n\nprose only\n`))).toHaveLength(1);
  });

  it("errors on missing frontmatter for vault docs", () => {
    const issues = lintDoc("Brain/lesson/bare.md", "# Bare\n\n## Lesson\nx\n");
    expect(errors(issues).map((i) => i.message)).toEqual(["missing frontmatter (doctype, audience, reviewed)"]);
  });

  it("errors on an unknown doctype and on a bad reviewed date", () => {
    expect(errors(lintDoc("Brain/x.md", "---\ndoctype: memo\naudience: human\nreviewed: 2026-11-01\n---\n# x\n"))[0]?.message).toMatch(/unknown doctype/);
    const bad = errors(lintDoc("Brain/lesson/d.md", "---\ndoctype: lesson\naudience: human\nreviewed: 2026-13-45\n---\n# L\n\n## Lesson\n"));
    expect(bad.map((i) => i.message)).toEqual(["reviewed must be a YYYY-MM-DD date"]);
  });
});

describe("inferred-by-path docs", () => {
  it("infers types from known paths", () => {
    expect(inferDocType("STATUS.md")).toBe("status");
    expect(inferDocType("GLOSSARY.md")).toBe("glossary");
    expect(inferDocType("docs/PLAN.md")).toBe("plan");
    expect(inferDocType("docs/adr/0001-x.md")).toBe("adr");
    expect(inferDocType("docs/PHASES.md")).toBeUndefined();
  });

  it("warns, not errors, when frontmatter is missing on an inferred doc", () => {
    const issues = lintDoc("docs/adr/0002-x.md", "# Title\n\nContext here.\n");
    expect(errors(issues)).toEqual([]);
    expect(issues.some((i) => i.severity === "warning" && /inferred "adr"/.test(i.message))).toBe(true);
  });
});
