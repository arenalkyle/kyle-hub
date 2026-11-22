import { describe, expect, it } from "vitest";
import { applyDrop, nextExpand, resolveZone } from "../src/tile-layout";

describe("tile layout", () => {
  it("splits right and below", () => {
    expect(applyDrop([["a"]], "b", "a", "right")).toEqual([["a"], ["b"]]);
    expect(applyDrop([["a"]], "b", "a", "left")).toEqual([["b"], ["a"]]);
    expect(applyDrop([["a"]], "b", "a", "below")).toEqual([["a", "b"]]);
  });
  it("moves an already-shown session and drops emptied columns", () => {
    expect(applyDrop([["a"], ["b"]], "b", "a", "below")).toEqual([["a", "b"]]);
  });
  it("caps at 4 columns and 2 rows, falling back to replace", () => {
    const four = [["a"], ["b"], ["c"], ["d"]];
    expect(resolveZone(four, "e", "a", "right")).toBe("replace");
    expect(applyDrop(four, "e", "a", "right")).toEqual([["e"], ["b"], ["c"], ["d"]]);
    expect(resolveZone([["a", "b"]], "c", "a", "below")).toBe("replace");
  });
  it("swaps on replace when dragged is shown", () => {
    expect(applyDrop([["a"], ["b"]], "b", "a", "replace")).toEqual([["b"], ["a"]]);
  });
  it("cycles expand", () => {
    expect(nextExpand([["a", "b"], ["c"]], "a", 0)).toBe(1);
    expect(nextExpand([["a", "b"], ["c"]], "a", 1)).toBe(2);
    expect(nextExpand([["a", "b"], ["c"]], "a", 2)).toBe(0);
    expect(nextExpand([["a"], ["c"]], "a", 0)).toBe(2);
    expect(nextExpand([["a", "b"]], "a", 1)).toBe(0);
    expect(nextExpand([["a"]], "a", 0)).toBe(0);
  });
});
