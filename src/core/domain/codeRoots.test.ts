import { describe, expect, it } from "vitest";
import { createCodeMatcher, createExcludeMatcher, findCodeRoots, isCodeMarker } from "./codeRoots";
import { parseGradingConfig } from "./grading";

describe("code roots", () => {
  it("recognises each marker", () => {
    for (const m of [".git", "package.json", "Cargo.toml", "pyproject.toml", "go.mod", "App.csproj", "x.sln", "CMakeLists.txt"]) expect(isCodeMarker(m), m).toBe(true);
    for (const m of ["README.md", "notes.json", "package.json.bak", "csproj"]) expect(isCodeMarker(m), m).toBe(false);
  });

  it("finds roots, never the vault root, outermost only", () => {
    const roots = findCodeRoots([
      { path: "", names: [".git", "Brain"] },
      { path: "Projects/app", names: ["package.json", "src"] },
      { path: "Projects/app/packages/a", names: ["package.json"] },
      { path: "Projects/notes", names: ["a.md"] },
      { path: "tools\\cli", names: ["Cargo.toml"] },
    ]);
    expect(roots).toEqual(["Projects/app", "tools/cli"]);
  });

  it("matches paths under roots and exclude globs", () => {
    const m = createCodeMatcher(["Projects/app"], ["**/vendor", "Scratch/*.md", "gen?"]);
    expect(m("Projects/app/README.md")).toBe(true);
    expect(m("projects\\APP\\docs\\a.md")).toBe(true);
    expect(m("Projects/app2/a.md")).toBe(false);
    expect(m("Projects/a/vendor/x.md")).toBe(true);
    expect(m("vendor/x.md")).toBe(true);
    expect(m("Scratch/a.md")).toBe(true);
    expect(m("Scratch/sub/a.md")).toBe(false);
    expect(m("gen1/a.md")).toBe(true);
    expect(m("Notes/a.md")).toBe(false);
    expect(m(".")).toBe(false);
    expect(createExcludeMatcher([])("a.md")).toBe(false);
  });

  it("parses grading `exclude` with a warning on bad values", () => {
    expect(parseGradingConfig(undefined).config.exclude).toEqual([]);
    expect(parseGradingConfig('{"exclude":["a/**"]}').config.exclude).toEqual(["a/**"]);
    const bad = parseGradingConfig('{"exclude":[1]}');
    expect(bad.config.exclude).toEqual([]);
    expect(bad.warning).toMatch(/exclude/);
    expect(parseGradingConfig('{"exclude":"a"}').warning).toMatch(/exclude/);
  });
});
