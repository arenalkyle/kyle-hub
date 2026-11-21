import { describe, expect, it } from "vitest";
import { LABEL_PALETTE, filterBy, matchesQuery, nextLabelColor } from "./match";

describe("matchesQuery", () => {
  it("matches empty query", () => expect(matchesQuery("  ", "x")).toBe(true));
  it("is case-insensitive on id or title", () => {
    expect(matchesQuery("tix-1", "TIX-12", "Fix login")).toBe(true);
    expect(matchesQuery("LOGIN", "TIX-12", "Fix login")).toBe(true);
    expect(matchesQuery("nope", "TIX-12", "Fix login")).toBe(false);
  });
  it("requires all tokens", () => {
    expect(matchesQuery("fix tix", "TIX-12", "Fix login")).toBe(true);
    expect(matchesQuery("fix zzz", "TIX-12", "Fix login")).toBe(false);
  });
  it("ignores undefined fields", () => expect(matchesQuery("a", undefined, "abc")).toBe(true));
});

describe("filterBy / nextLabelColor", () => {
  it("filters", () => {
    const items = [{ id: "TIX-1", t: "Alpha" }, { id: "TIX-2", t: "Beta" }];
    expect(filterBy(items, "beta", (i) => [i.id, i.t])).toEqual([items[1]]);
  });
  it("picks the next unused color", () => {
    expect(nextLabelColor({})).toBe(LABEL_PALETTE[0]);
    expect(nextLabelColor({ a: LABEL_PALETTE[0].toUpperCase() })).toBe(LABEL_PALETTE[1]);
  });
  it("cycles when exhausted", () => {
    const all = Object.fromEntries(LABEL_PALETTE.map((c, i) => [`l${i}`, c]));
    expect(LABEL_PALETTE).toContain(nextLabelColor(all));
  });
});
