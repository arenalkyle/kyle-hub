import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { quotePath, quotePaths, saveImage } from "../src/paste-file";

describe("quotePath", () => {
  it("quotes Windows paths only when needed", () => {
    expect(quotePath("C:\a\b.png", "win32")).toBe("C:\a\b.png");
    expect(quotePath("C:\My Pics\b.png", "win32")).toBe('"C:\My Pics\b.png"');
  });
  it("escapes spaces and shell characters on macOS", () => {
    expect(quotePath("/Users/me/Screen Shot (1).png", "darwin")).toBe("/Users/me/Screen\ Shot\ \(1\).png");
  });
  it("joins several with a trailing space", () => {
    expect(quotePaths(["/a", "/b"], "darwin")).toBe("/a /b ");
    expect(quotePaths([], "darwin")).toBe("");
  });
});

describe("saveImage", () => {
  it("writes the image bytes to a temp file with the right extension", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kh-paste-"));
    const file = await saveImage(new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), dir, new Date("2026-01-02T03:04:05Z"));
    expect(path.basename(file)).toBe("paste-2026-01-02T03-04-05-000Z.jpg");
    expect([...fs.readFileSync(file)]).toEqual([1, 2, 3]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
