import { describe, expect, it } from "vitest";
import { keyToAction, moveSelection, triageKeyToAction, type KeyInfo } from "./shortcuts";

const k = (key: string, o: Partial<KeyInfo> = {}): KeyInfo => ({
  key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, editable: false, ...o,
});

describe("keyToAction", () => {
  it("maps the documented keys", () => {
    const map: Record<string, string> = {
      j: "next", k: "prev", ArrowDown: "next", ArrowUp: "prev", Enter: "open", Escape: "clear",
      c: "new", s: "status", p: "priority", l: "labels", a: "assignee", f: "filter",
    };
    for (const [key, action] of Object.entries(map)) expect(keyToAction(k(key))).toBe(action);
    expect(keyToAction(k("J", { shiftKey: true }))).toBe("next");
    expect(keyToAction(k("B", { ctrlKey: true, shiftKey: true }))).toBe("toggleLayout");
  });
  it("ignores everything while typing", () => {
    for (const key of ["j", "c", "Enter", "Escape", "ArrowDown"]) expect(keyToAction(k(key, { editable: true }))).toBeNull();
    expect(keyToAction(k("b", { ctrlKey: true, shiftKey: true, editable: true }))).toBeNull();
  });
  it("leaves modified and unknown keys to Obsidian", () => {
    expect(keyToAction(k("s", { ctrlKey: true }))).toBeNull();
    expect(keyToAction(k("b", { ctrlKey: true }))).toBeNull();
    expect(keyToAction(k("c", { altKey: true }))).toBeNull();
    expect(keyToAction(k("c", { metaKey: true }))).toBeNull();
    expect(keyToAction(k("x"))).toBeNull();
    expect(keyToAction(k("Tab"))).toBeNull();
  });
  it("keeps Enter native on buttons", () => {
    expect(keyToAction(k("Enter", { interactive: true }))).toBeNull();
  });
});

describe("moveSelection", () => {
  const ids = ["a", "b", "c"];
  it("starts at the ends and clamps", () => {
    expect(moveSelection(ids, null, 1)).toBe("a");
    expect(moveSelection(ids, null, -1)).toBe("c");
    expect(moveSelection(ids, "a", -1)).toBe("a");
    expect(moveSelection(ids, "c", 1)).toBe("c");
    expect(moveSelection(ids, "a", 1)).toBe("b");
    expect(moveSelection(ids, "zzz", 1)).toBe("a");
    expect(moveSelection([], "a", 1)).toBeNull();
  });
});

describe("triageKeyToAction", () => {
  it("maps j/k/Enter/a/r/d/u and ignores typing and modifiers", () => {
    const map: Record<string, string> = { j: "next", k: "prev", Enter: "open", a: "accept", r: "ready", d: "decline", u: "undo", ArrowDown: "next" };
    for (const [key, action] of Object.entries(map)) expect(triageKeyToAction(k(key))).toBe(action);
    for (const key of Object.keys(map)) expect(triageKeyToAction(k(key, { editable: true }))).toBeNull();
    expect(triageKeyToAction(k("a", { ctrlKey: true }))).toBeNull();
    expect(triageKeyToAction(k("Enter", { interactive: true }))).toBeNull();
    expect(triageKeyToAction(k("s"))).toBeNull();
  });
});
