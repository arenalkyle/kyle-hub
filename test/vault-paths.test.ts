import { describe, expect, it } from "vitest";
import { buildRef, buildRefs, parseDropText } from "../src/vault-paths";

describe("buildRef win32", () => {
  const cwd = "C:\\Vault\\Proj";
  it("relative inside cwd uses forward slashes", () => {
    expect(buildRef("C:\\Vault\\Proj\\notes\\a.md", cwd, "relative", "win32")).toBe("@notes/a.md");
  });
  it("is case-insensitive about cwd", () => {
    expect(buildRef("c:\\vault\\proj\\a.md", cwd, "relative", "win32")).toBe("@a.md");
  });
  it("absolute mode keeps backslashes", () => {
    expect(buildRef("C:\\Vault\\Proj\\a.md", cwd, "absolute", "win32")).toBe("@C:\\Vault\\Proj\\a.md");
  });
  it("outside cwd is absolute even in relative mode", () => {
    expect(buildRef("C:\\Vault\\Other\\a.md", cwd, "relative", "win32")).toBe("@C:\\Vault\\Other\\a.md");
    expect(buildRef("D:\\x\\a.md", cwd, "relative", "win32")).toBe("@D:\\x\\a.md");
  });
  it("sibling with same prefix is outside", () => {
    expect(buildRef("C:\\Vault\\Proj2\\a.md", cwd, "relative", "win32")).toBe("@C:\\Vault\\Proj2\\a.md");
  });
  it("quotes paths with spaces", () => {
    expect(buildRef("C:\\Vault\\Proj\\My Note.md", cwd, "relative", "win32")).toBe('@"My Note.md"');
    expect(buildRef("C:\\My Vault\\a.md", cwd, "relative", "win32")).toBe('@"C:\\My Vault\\a.md"');
  });
  it("trailing slash is trimmed", () => {
    expect(buildRef("C:\\Vault\\Proj\\sub\\", cwd, "relative", "win32")).toBe("@sub");
    expect(buildRef("C:\\Vault\\Other\\", cwd, "relative", "win32")).toBe("@C:\\Vault\\Other");
  });
});

describe("buildRef posix", () => {
  it("relative/absolute/outside/spaces", () => {
    expect(buildRef("/v/p/a.md", "/v/p", "relative", "posix")).toBe("@a.md");
    expect(buildRef("/v/p/a.md", "/v/p", "absolute", "posix")).toBe("@/v/p/a.md");
    expect(buildRef("/v/q/a.md", "/v/p", "relative", "posix")).toBe("@/v/q/a.md");
    expect(buildRef("/v/p/a b.md", "/v/p", "relative", "posix")).toBe('@"a b.md"');
  });
  it("no cwd -> absolute", () => {
    expect(buildRef("/v/a.md", undefined, "relative", "posix")).toBe("@/v/a.md");
  });
});

it("buildRefs joins with spaces", () => {
  expect(buildRefs(["/v/a.md", "/v/b c.md"], "/v", "relative", "posix")).toBe('@a.md @"b c.md"');
});

describe("parseDropText", () => {
  it("obsidian url for this vault", () => {
    expect(parseDropText("obsidian://open?vault=V&file=Folder%2FMy%20Note.md", "V")).toEqual({ kind: "paths", paths: ["Folder/My Note.md"] });
  });
  it("other vault stays text", () => {
    expect(parseDropText("obsidian://open?vault=X&file=a", "V").kind).toBe("text");
  });
  it("wikilinks, multiple lines", () => {
    expect(parseDropText("[[A]]\n[[B|alias]]", "V")).toEqual({ kind: "paths", paths: ["A", "B"] });
  });
  it("plain text", () => {
    expect(parseDropText("hello world", "V")).toEqual({ kind: "text", text: "hello world" });
  });
});
