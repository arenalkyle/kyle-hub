import { describe, expect, it } from "vitest";
import { buildPack, packFooter, PACK_BUDGET_CHARS, stripAcceptance } from "./pack";
import { queueOrder } from "./queue";
import type { Issue } from "./types";

const description = "Do the thing.\n\n## Acceptance criteria\n\n- [ ] first\n- [x] second\n\n## Notes\n\nextra";

describe("buildPack", () => {
  it("matches the golden pack", () => {
    const out = buildPack({
      runId: "r-20261121-101500-LOCK-9",
      ticket: { id: "LOCK-9", title: "Add widget", description },
      repo: "hub",
      branch: "kh/LOCK-9-add-widget",
      parent: { id: "LOCK-1", title: "Epic", description: Array.from({ length: 50 }, (_, i) => `p${i}`).join("\n") },
      blockers: [{ id: "LOCK-5", title: "Dep", lastComment: "done, see PR" }, { id: "LOCK-6", title: "Other" }],
      previousRun: "r-20261120-090000-LOCK-9",
    });
    expect(out).toBe(`# LOCK-9: Add widget

Run: r-20261121-101500-LOCK-9 · Repo: hub · Branch: kh/LOCK-9-add-widget

## Description

Do the thing.

## Notes

extra

## Acceptance criteria

- [ ] first
- [x] second

## Parent: LOCK-1: Epic

${Array.from({ length: 40 }, (_, i) => `p${i}`).join("\n")}

## Blockers (last comment)

### LOCK-5: Dep

done, see PR

### LOCK-6: Other

(no comments)

## Previous run

Previous run of this ticket: r-20261120-090000-LOCK-9. The worktree is reused; check \`git log\` and the ticket comments for what was done.

${packFooter("LOCK-9")}
`);
  });

  it("always ends with the footer and names kt comment", () => {
    const out = buildPack({ runId: "r", ticket: { id: "T-1", title: "t", description: "" } });
    expect(out).toContain('kt comment T-1 "<summary');
    expect(out).toContain("Do not change the ticket status.");
    expect(out.trimEnd().endsWith(packFooter("T-1"))).toBe(true);
  });

  it("truncates the description first and stays within budget", () => {
    const out = buildPack({
      runId: "r",
      ticket: { id: "T-1", title: "t", description: "x".repeat(60_000) + "\n\n## Acceptance criteria\n\n- [ ] keep me" },
      blockers: [{ id: "T-0", title: "b", lastComment: "blocker note" }],
    });
    expect(out.length).toBeLessThanOrEqual(PACK_BUDGET_CHARS);
    expect(out).toContain("[truncated]");
    expect(out).toContain("- [ ] keep me");
    expect(out).toContain("blocker note");
    expect(out).toContain(packFooter("T-1"));
  });

  it("cuts later sections once the description is gone", () => {
    const out = buildPack({
      runId: "r",
      budget: 700,
      ticket: { id: "T-1", title: "t", description: "d".repeat(2000) },
      parent: { id: "P", title: "p", description: "q".repeat(2000) },
    });
    expect(out.length).toBeLessThanOrEqual(700);
    expect(out).toContain(packFooter("T-1"));
  });

  it("stripAcceptance removes only that section", () => {
    expect(stripAcceptance(description)).toBe("Do the thing.\n\n## Notes\n\nextra");
  });
});

describe("queueOrder", () => {
  const t = (id: string, priority: Issue["priority"], sortOrder?: number) => ({ id, priority, sortOrder }) as Issue;
  it("orders by priority then sortOrder then id", () => {
    const out = queueOrder([t("C-3", "low", 1), t("C-2", "high", 5), t("C-1", "high", 2), t("C-4", "high"), t("C-5", "urgent", 9)]);
    expect(out.map((i) => i.id)).toEqual(["C-5", "C-1", "C-2", "C-4", "C-3"]);
  });
});
