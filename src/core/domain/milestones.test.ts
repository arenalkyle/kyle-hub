import { describe, expect, it } from "vitest";
import { DEFAULT_STATUSES } from "./defaults";
import {
  isMilestoneOverdue,
  milestoneAfterProjectChange,
  milestoneProgress,
  moveItem,
  reorderMilestones,
  validateMilestoneName,
} from "./milestones";
import { parseProject, serializeProject } from "./projectFile";
import { groupIssues } from "./query";
import type { Issue, Milestone, Project } from "./types";

const cat = (n: string) => DEFAULT_STATUSES.find((s) => s.category === n)!.name;
const issue = (id: string, status: string, project?: string, milestone?: string) => ({ id, status, project, milestone }) as unknown as Issue;
const ms = (...names: string[]): Milestone[] => names.map((name) => ({ name }));
const web = { name: "Web", milestones: ms("Alpha", "Beta", "Empty") };

describe("milestoneProgress", () => {
  it("counts done over non-canceled per milestone, in milestone order", () => {
    const issues = [
      issue("1", cat("completed"), "[[Web]]", "Alpha"),
      issue("2", cat("started"), "[[Web]]", "Alpha"),
      issue("3", cat("started"), "[[Web]]", "[[Alpha]]"),
      issue("4", cat("canceled"), "[[Web]]", "Alpha"),
      issue("5", cat("completed"), "[[Web]]", "Beta"),
      issue("6", cat("completed"), "[[Other]]", "Alpha"),
      issue("7", cat("completed"), undefined, "Alpha"),
    ];
    expect(milestoneProgress(web, issues, DEFAULT_STATUSES)).toEqual([
      { name: "Alpha", done: 1, total: 3, percent: 33 },
      { name: "Beta", done: 1, total: 1, percent: 100 },
      { name: "Empty", done: 0, total: 0, percent: 0 },
    ]);
  });
});

describe("isMilestoneOverdue", () => {
  const today = "2026-11-21";
  it("needs a past target and incomplete work", () => {
    expect(isMilestoneOverdue({ target: "2026-11-20" }, { done: 1, total: 2 }, today)).toBe(true);
    expect(isMilestoneOverdue({ target: "2026-11-20" }, { done: 0, total: 0 }, today)).toBe(true);
    expect(isMilestoneOverdue({ target: "2026-11-20" }, { done: 2, total: 2 }, today)).toBe(false);
    expect(isMilestoneOverdue({ target: "2026-11-21" }, { done: 0, total: 2 }, today)).toBe(false);
    expect(isMilestoneOverdue({}, { done: 0, total: 2 }, today)).toBe(false);
  });
});

describe("validateMilestoneName", () => {
  it("rejects empty and duplicates (case-insensitive) but allows its own name", () => {
    expect(validateMilestoneName(" ", [])).not.toBeNull();
    expect(validateMilestoneName("alpha", ["Alpha"])).not.toBeNull();
    expect(validateMilestoneName("alpha", ["Alpha"], "Alpha")).toBeNull();
    expect(validateMilestoneName("Gamma", ["Alpha"])).toBeNull();
  });
});

describe("milestoneAfterProjectChange", () => {
  it("keeps a milestone the new project has and clears the rest", () => {
    expect(milestoneAfterProjectChange("Alpha", web)).toBe("Alpha");
    expect(milestoneAfterProjectChange("[[beta]]", web)).toBe("[[beta]]");
    expect(milestoneAfterProjectChange("Gamma", web)).toBeUndefined();
    expect(milestoneAfterProjectChange("Alpha", null)).toBeUndefined();
    expect(milestoneAfterProjectChange(undefined, web)).toBeUndefined();
  });
});

describe("reordering", () => {
  it("moveItem and reorderMilestones", () => {
    expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
    expect(moveItem([1, 2, 3], 5, 0)).toEqual([1, 2, 3]);
    expect(reorderMilestones(ms("A", "B", "C"), ["B", "A"]).map((m) => m.name)).toEqual(["B", "A", "C"]);
  });
  it("round-trips through the project file, keeping unknown keys", () => {
    const text = "---\nkind: kt-project\nname: Web\nx-custom: keep\nmilestones:\n  - name: Alpha\n    target: 2026-12-01\n  - name: Beta\n    description: Later\n---\nBody\n";
    const p = parseProject(text, "Web.md");
    p.milestones = reorderMilestones(p.milestones, ["Beta", "Alpha"]);
    const back = parseProject(serializeProject(p), "Web.md");
    expect(back.milestones).toEqual([{ name: "Beta", description: "Later" }, { name: "Alpha", target: "2026-12-01" }]);
    expect(serializeProject(p)).toContain("x-custom: keep");
    expect(back.description).toBe("Body");
  });
});

describe("milestone grouping order", () => {
  it("orders by the project's milestones with No milestone last", () => {
    const issues = [issue("1", "Todo", "[[Web]]", "Alpha"), issue("2", "Todo", "[[Web]]", "Beta"), issue("3", "Todo", "[[Web]]")];
    const project = { name: "Web", milestones: ms("Beta", "Alpha") } as unknown as Project;
    const groups = groupIssues(issues, "milestone", { statuses: DEFAULT_STATUSES }, { projects: [project], milestoneOrder: ["Beta", "Alpha"] });
    expect(groups.map((g) => g.label)).toEqual(["Beta", "Alpha", "No milestone"]);
  });
});
