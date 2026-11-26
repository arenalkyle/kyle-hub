import { describe, expect, it } from "vitest";
import { brainFolders, conventionPaths, DEFAULT_BRAIN_FOLDER, lessonPath, normalizeVaultFolder, pruneLayoutKeys } from "./brainPaths";

describe("normalizeVaultFolder", () => {
  it("normalises slashes, ./ and leading/trailing slashes", () => {
    expect(normalizeVaultFolder(" docs ")).toBe("docs");
    expect(normalizeVaultFolder("./docs/brain/")).toBe("docs/brain");
    expect(normalizeVaultFolder("docs\\conventions")).toBe("docs/conventions");
    expect(normalizeVaultFolder("/docs//conventions/")).toBe("docs/conventions");
  });
  it("rejects empty, non-string, absolute and escaping paths", () => {
    for (const bad of ["", "  ", ".", undefined, 3, "C:\\vault\\docs", "\\\\wsl$\\Ubuntu\\x", "../other", "docs/../.."]) {
      expect(normalizeVaultFolder(bad)).toBe("");
    }
  });
});

describe("brainFolders", () => {
  it("defaults to Brain and Brain/conventions", () => {
    expect(brainFolders(undefined)).toEqual({ brainFolder: "Brain", conventionsFolder: "Brain/conventions" });
    expect(brainFolders({ brainFolder: "", conventionsFolder: "" })).toEqual({ brainFolder: DEFAULT_BRAIN_FOLDER, conventionsFolder: "Brain/conventions" });
  });
  it("conventions follow the brain folder unless set on their own", () => {
    expect(brainFolders({ brainFolder: "docs" })).toEqual({ brainFolder: "docs", conventionsFolder: "docs/conventions" });
    expect(brainFolders({ conventionsFolder: "docs/conventions/" })).toEqual({ brainFolder: "Brain", conventionsFolder: "docs/conventions" });
    expect(brainFolders({ brainFolder: "docs/brain", conventionsFolder: "docs/conventions" })).toEqual({ brainFolder: "docs/brain", conventionsFolder: "docs/conventions" });
  });
  it("an invalid setting falls back to the default", () => {
    expect(brainFolders({ brainFolder: "../x", conventionsFolder: "C:\\c" })).toEqual({ brainFolder: "Brain", conventionsFolder: "Brain/conventions" });
  });
});

describe("derived paths", () => {
  it("conventions and lessons", () => {
    expect(conventionPaths(brainFolders({ conventionsFolder: "docs/conventions" }))).toEqual({ agent: "docs/conventions/agent.md", human: "docs/conventions/human.md" });
    expect(conventionPaths(brainFolders({ brainFolder: "docs" })).agent).toBe("docs/conventions/agent.md");
    expect(lessonPath("docs", "x.md")).toBe("docs/lessons/x.md");
  });
});

describe("pruneLayoutKeys", () => {
  it("keeps entries for existing notes and folders, drops the rest", () => {
    const live = new Set(["docs", "docs/conventions", "docs/conventions/agent.md"]);
    const stored = { "/": 0, "Brain/": 1, "Brain/conventions/": 2, "Brain/conventions/agent.md": 3, "docs/": 4, "docs/conventions/": 5, "docs/conventions/agent.md": 6 };
    expect(pruneLayoutKeys(stored, (p) => live.has(p))).toEqual({ "/": 0, "docs/": 4, "docs/conventions/": 5, "docs/conventions/agent.md": 6 });
  });
});
