import { describe, expect, it } from "vitest";
import { DOC_TYPES } from "../../core/brain/doctypes";
import { nextAdrNumber, renderTemplate, slugify } from "../../core/brain/newDoc";
import { localDate, planNewDoc } from "./newDoc";
import { TEMPLATES } from "./templates";

const DATE = "2026-11-21";

describe("New doc templates", () => {
  it("every doc type has a template with frontmatter and lint-clean output", () => {
    for (const type of DOC_TYPES) {
      expect(TEMPLATES[type], type).toMatch(new RegExp(`^---\\ndoctype: ${type}\\n`));
      const vault = planNewDoc(type, `Sample ${type}`, DATE, { kind: "vault" });
      expect(vault.issues.filter((i) => i.severity === "error"), type).toEqual([]);
      expect(vault.path).toBe(`Brain/${type}/sample-${type}.md`);
      expect(vault.content).toContain(`reviewed: ${DATE}`);
    }
  });

  it("repo locations: ADR auto-numbered, lint-clean; lesson and overview refused (ADR-0007)", () => {
    const adr = planNewDoc("adr", "Use Foo Bar", DATE, { kind: "repo", root: "/x", adrFileNames: ["0001-a.md", "0007-b.md"] });
    expect(adr.path).toBe("docs/adr/0008-use-foo-bar.md");
    expect(adr.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(() => planNewDoc("lesson", "L", DATE, { kind: "repo", root: "/x", adrFileNames: [] })).toThrow(/vault/);
    expect(() => planNewDoc("overview", "O", DATE, { kind: "repo", root: "/x", adrFileNames: [] })).toThrow(/vault/);
  });

  it("vault docs go under the brain folder setting", () => {
    expect(planNewDoc("lesson", "Deep Work", DATE, { kind: "vault", brainFolder: "docs/brain" }).path).toBe("docs/brain/lesson/deep-work.md");
  });

  it("status template is the repo STATUS.md location", () => {
    expect(planNewDoc("status", "Anything", DATE, { kind: "repo", root: "/x", adrFileNames: [] }).path).toBe("STATUS.md");
  });
});

describe("helpers", () => {
  it("slugify, ADR numbering, placeholder rendering", () => {
    expect(slugify("  Hello, World!  ")).toBe("hello-world");
    expect(slugify("!!!")).toBe("untitled");
    expect(nextAdrNumber([])).toBe("0001");
    expect(nextAdrNumber(["0009-x.md", "README.md"])).toBe("0010");
    expect(renderTemplate("{{title}} {{date}} {{number}} {{other}}", { title: "T", date: DATE })).toBe("T 2026-11-21  {{other}}");
  });

  it("localDate uses the local calendar day", () => {
    expect(localDate(new Date(2026, 10, 21, 23, 59))).toBe("2026-11-21");
  });
});
