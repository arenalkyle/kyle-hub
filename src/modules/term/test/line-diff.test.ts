import { describe, expect, it } from "vitest";
import { diffLines, trimContext } from "../src/line-diff";

describe("diffLines", () => {
  it("marks additions and removals", () => {
    const d = diffLines("a\nb\nc\n", "a\nx\nc\nd\n");
    expect(d.map((l) => `${l.kind}:${l.text}`)).toEqual(["same:a", "del:b", "add:x", "same:c", "add:d"]);
  });
  it("empty before is all additions; identical is all same", () => {
    expect(diffLines("", "a\nb").every((l) => l.kind === "add")).toBe(true);
    expect(diffLines("a\n", "a\n").every((l) => l.kind === "same")).toBe(true);
  });
  it("trimContext collapses long unchanged runs", () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
    const after = before.replace("l10", "changed");
    const t = trimContext(diffLines(before, after), 1);
    expect(t.map((l) => l.text)).toEqual(["…", "l9", "l10", "changed", "l11", "…"]);
  });
});
