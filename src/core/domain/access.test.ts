import { describe, expect, it } from "vitest";
import { accessFromHook, countHits, toVaultRelative } from "./access";

const V = "C:\\Vaults\\Home";
const post = (tool_name: string, tool_input: unknown, tool_response?: unknown, cwd = V) => ({ tool_name, tool_input, tool_response, cwd });

describe("toVaultRelative", () => {
  it("scopes to the vault, case-insensitively, either slash", () => {
    expect(toVaultRelative(V, "c:/vaults/home/Brain/a.md")).toBe("Brain/a.md");
    expect(toVaultRelative(V, "C:\\Vaults\\Home")).toBe(".");
    expect(toVaultRelative(V, "C:\\Vaults\\Home2\\a.md")).toBeUndefined();
    expect(toVaultRelative(V, "C:\\Other\\a.md")).toBeUndefined();
    expect(toVaultRelative(V, "C:\\Vaults\\Home\\..\\Secret\\a.md")).toBeUndefined();
  });
  it("resolves relative paths against cwd", () => {
    expect(toVaultRelative(V, "a.md", "C:\\Vaults\\Home\\Brain")).toBe("Brain/a.md");
    expect(toVaultRelative(V, "a.md")).toBeUndefined();
  });
});

describe("accessFromHook", () => {
  it("records read and write paths only, never contents", () => {
    const r = accessFromHook("PostToolUse", post("Read", { file_path: `${V}\\Brain\\x.md` }, { content: "SECRET BODY" }), V);
    expect(r).toEqual({ kind: "read", path: "Brain/x.md" });
    expect(accessFromHook("PostToolUse", post("Edit", { file_path: `${V}\\n.md`, new_string: "SECRET" }), V)).toEqual({ kind: "write", path: "n.md" });
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });
  it("drops events outside the vault and non-PostToolUse events", () => {
    expect(accessFromHook("PostToolUse", post("Read", { file_path: "C:\\Repos\\a.ts" }, "x", "C:\\Repos"), V)).toBeNull();
    expect(accessFromHook("PostToolUse", post("Grep", { pattern: "x", path: "C:\\Repos" }), V)).toBeNull();
    expect(accessFromHook("PostToolUse", post("Grep", { pattern: "x" }, "", "C:\\Repos"), V)).toBeNull();
    expect(accessFromHook("PreToolUse", post("Read", { file_path: `${V}\\a.md` }), V)).toBeNull();
    expect(accessFromHook("PostToolUse", post("Bash", { command: "ls" }), V)).toBeNull();
  });
  it("search keeps pattern, vault-relative root and hit count", () => {
    const r = accessFromHook("PostToolUse", post("Grep", { pattern: "todo", path: `${V}\\Brain` }, { numFiles: 3, filenames: ["a", "b", "c"] }), V);
    expect(r).toEqual({ kind: "search", root: "Brain", pattern: "todo", hits: 3 });
    expect(accessFromHook("PostToolUse", post("Glob", { pattern: "**/*.md" }, { filenames: ["a", "b"] }), V)).toEqual({ kind: "search", root: ".", pattern: "**/*.md", hits: 2 });
  });
});

describe("countHits", () => {
  it("handles numbers, lists and short strings; unknown otherwise", () => {
    expect(countHits({ numFiles: 0 })).toBe(0);
    expect(countHits({ filenames: ["a"] })).toBe(1);
    expect(countHits(["a", "b"])).toBe(2);
    expect(countHits("a\nb\n\n")).toBe(2);
    expect(countHits("x".repeat(600))).toBeUndefined();
    expect(countHits(undefined)).toBeUndefined();
  });
});
