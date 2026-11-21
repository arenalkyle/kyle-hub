import { describe, expect, it } from "vitest";
import { findIdMatches } from "./idLinks";

const ids = (text: string, prefix = "TIX") => findIdMatches(text, prefix).map((m) => m.id);

describe("findIdMatches", () => {
  it("matches a plain ID with its position", () => {
    expect(findIdMatches("see TIX-12 now", "TIX")).toEqual([{ id: "TIX-12", index: 4, length: 6 }]);
  });

  it("rejects IDs glued to word characters", () => {
    expect(ids("XTIX-1")).toEqual([]);
    expect(ids("TIX-1a")).toEqual([]);
    expect(ids("TIX-1_x")).toEqual([]);
    expect(ids("FOO-TIX-1")).toEqual([]);
  });

  it("matches a trailing punctuation mark", () => {
    expect(ids("Fixed in TIX-12.")).toEqual(["TIX-12"]);
    expect(ids("(TIX-12), TIX-3!")).toEqual(["TIX-12", "TIX-3"]);
  });

  it("is case-sensitive", () => {
    expect(ids("tix-1 Tix-1")).toEqual([]);
  });

  it("finds several IDs on one line", () => {
    expect(ids("TIX-1 blocks TIX-22 and TIX-333")).toEqual(["TIX-1", "TIX-22", "TIX-333"]);
  });

  it("ignores wikilinks", () => {
    expect(ids("[[TIX-12]] and TIX-13")).toEqual(["TIX-13"]);
  });

  it("only matches the configured prefix and escapes regex characters", () => {
    expect(ids("LOCK-2 TIX-2", "LOCK")).toEqual(["LOCK-2"]);
    expect(ids("A.B-1 AxB-1", "A.B")).toEqual(["A.B-1"]);
  });

  it("returns nothing for an empty prefix", () => {
    expect(ids("TIX-1", "")).toEqual([]);
  });
});
