import { describe, expect, it } from "vitest";
import { normalizeCommand, normalizeSig, pathRel } from "./normalize";

describe("command normalization", () => {
  it.each([
    ['git commit -m "x"', "git commit <str>"],
    ["npm run build", "npm run build"],
    ['"C:\\Program Files\\Git\\bin\\git.exe" status', "git status"],
    ["cat src/a.ts | head -n 20", "cat <path> ; head <num>"],
    ["Get-ChildItem -Path C:\\x -Recurse", "get-childitem <path>"],
    ["git log -n 5 --oneline", "git log <num>"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeCommand(input)).toBe(expected);
  });

  it("keeps quoted separators inside a single argument", () => {
    expect(normalizeCommand('echo "a | b"')).toBe("echo <str>");
  });
});

describe("error signature normalization", () => {
  it("keeps the first line and masks paths and numbers", () => {
    expect(normalizeSig("TypeError: x is undefined at /a/b.ts:12\n  at main")).toBe("TypeError: x is undefined at <path>:<num>");
  });

  it("returns empty for blank text", () => {
    expect(normalizeSig("  \n ")).toBe("");
  });
});

describe("repo-relative paths", () => {
  it("returns repo-relative forward-slash paths", () => {
    expect(pathRel("C:\\work\\demo\\src\\a.ts", "C:\\work\\demo")).toBe("src/a.ts");
  });

  it("masks files outside the repo", () => {
    expect(pathRel("C:\\other\\x.md", "C:\\work\\demo")).toBe("<external>/x.md");
  });
});
