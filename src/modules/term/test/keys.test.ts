import { describe, expect, it } from "vitest";
import { decideKey, type KeyLike } from "../src/keys";

const k = (key: string, m: Partial<KeyLike> = {}): KeyLike => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...m });

describe("key decisions (Windows)", () => {
  it("Ctrl+C copies only with a selection, so it still interrupts", () => {
    expect(decideKey(k("c", { ctrlKey: true }), true)).toBe("copy");
    expect(decideKey(k("c", { ctrlKey: true }), false)).toBeNull();
  });
  it("Ctrl+V pastes and Ctrl +/-/0 zoom", () => {
    expect(decideKey(k("v", { ctrlKey: true }), false)).toBe("paste");
    expect(decideKey(k("=", { ctrlKey: true }), false)).toBe("zoom-in");
    expect(decideKey(k("-", { ctrlKey: true }), false)).toBe("zoom-out");
    expect(decideKey(k("0", { ctrlKey: true }), false)).toBe("zoom-reset");
  });
  it("Meta combos are ignored", () => {
    expect(decideKey(k("c", { metaKey: true }), true)).toBeNull();
  });
  it("Shift+Enter is a newline", () => {
    expect(decideKey(k("Enter", { shiftKey: true }), false)).toBe("newline");
  });
});
