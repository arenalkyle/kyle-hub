import { describe, expect, it } from "vitest";
import { DEFAULT_STATUSES } from "./defaults";
import { projectProgress, rewriteProjectLink, sortProjects, splitArchived, validateProjectName } from "./projects";
import type { Issue, Project } from "./types";

const issue = (id: string, status: string, project?: string) => ({ id, status, project }) as unknown as Issue;
const proj = (name: string, status: Project["status"]) => ({ name, status }) as unknown as Project;

describe("validateProjectName", () => {
  it("accepts normal names", () => {
    expect(validateProjectName("Website", [])).toBeNull();
    expect(validateProjectName("  Web site 2 ", ["Other"])).toBeNull();
  });
  it("rejects empty, bad characters and dot names", () => {
    expect(validateProjectName("  ", [])).not.toBeNull();
    for (const c of '/\:*?"<>|') expect(validateProjectName(`a${c}b`, [])).not.toBeNull();
    expect(validateProjectName(".hidden", [])).not.toBeNull();
  });
  it("rejects duplicates case-insensitively but allows the project's own name", () => {
    expect(validateProjectName("website", ["Website"])).not.toBeNull();
    expect(validateProjectName("website", ["Website"], "Website")).toBeNull();
  });
});

describe("projectProgress", () => {
  const cat = (n: string) => DEFAULT_STATUSES.find((s) => s.category === n)!.name;
  it("counts completed over non-canceled", () => {
    const issues = [
      issue("1", cat("completed"), "[[Web]]"),
      issue("2", cat("started"), "[[Web]]"),
      issue("3", cat("canceled"), "[[Web]]"),
      issue("4", cat("completed"), "[[Other]]"),
      issue("5", cat("completed")),
    ];
    expect(projectProgress(issues, "Web", DEFAULT_STATUSES)).toEqual({ done: 1, total: 2, ratio: 0.5 });
  });
  it("is zero for an empty project and treats unknown statuses as open", () => {
    expect(projectProgress([], "Web", DEFAULT_STATUSES)).toEqual({ done: 0, total: 0, ratio: 0 });
    expect(projectProgress([issue("1", "Nope", "[[Web]]")], "Web", DEFAULT_STATUSES).total).toBe(1);
  });
});

describe("rewriteProjectLink", () => {
  it("rewrites matching links and keeps aliases", () => {
    expect(rewriteProjectLink("[[Website]]", "Website", "Web")).toBe("[[Web]]");
    expect(rewriteProjectLink("[[website|site]]", "Website", "Web")).toBe("[[Web|site]]");
    expect(rewriteProjectLink("Website", "Website", "Web")).toBe("[[Web]]");
  });
  it("leaves other links alone", () => {
    expect(rewriteProjectLink("[[Other]]", "Website", "Web")).toBe("[[Other]]");
  });
});

describe("project ordering", () => {
  it("orders by status then name and splits archived", () => {
    const ps = [proj("B", "completed"), proj("C", "backlog"), proj("A", "backlog"), proj("D", "started"), proj("E", "canceled")];
    expect(sortProjects(ps).map((p) => p.name)).toEqual(["D", "A", "C", "B", "E"]);
    const { active, archived } = splitArchived(ps);
    expect(active.map((p) => p.name)).toEqual(["D", "A", "C"]);
    expect(archived.map((p) => p.name)).toEqual(["B", "E"]);
  });
});
