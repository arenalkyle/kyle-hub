import { describe, expect, it } from "vitest";
import { cleanCopy } from "../src/copy-text";

describe("cleanCopy", () => {
  it("drops Claude's reply indent and trailing spaces", () => {
    expect(cleanCopy("  first line   \n  second\n    nested  ")).toBe("first line\nsecond\n  nested");
  });
  it("drops side borders and border-only lines of a box", () => {
    const box = "╭──────────────╮\n│ > fix the bug │\n│   and test    │\n╰──────────────╯";
    expect(cleanCopy(box)).toBe("> fix the bug\n  and test");
  });
  it("leaves ordinary text alone", () => {
    expect(cleanCopy("a | b\n\nc")).toBe("a | b\n\nc");
  });
});
