import { describe, expect, it } from "vitest";
import { bestState, isStale, parsePrUrl, prLabelOfUrl, toPrState } from "./pr";

describe("parsePrUrl", () => {
  it("parses plain and suffixed urls", () => {
    expect(parsePrUrl("https://github.com/a/b/pull/12")).toEqual({ owner: "a", repo: "b", number: 12, url: "https://github.com/a/b/pull/12" });
    expect(parsePrUrl(" https://github.com/a/b/pull/12/files ")?.number).toBe(12);
    expect(parsePrUrl("https://github.com/a/b.c/pull/3?x=1#y")?.repo).toBe("b.c");
  });
  it("rejects other hosts and shapes", () => {
    expect(parsePrUrl("https://github.example.com/a/b/pull/1")).toBeNull();
    expect(parsePrUrl("http://github.com/a/b/pull/1")).toBeNull();
    expect(parsePrUrl("https://github.com/a/b/issues/1")).toBeNull();
    expect(parsePrUrl("https://github.com/a/b/pull/x")).toBeNull();
    expect(parsePrUrl("https://evil.com/https://github.com/a/b/pull/1")).toBeNull();
  });
  it("labels", () => {
    expect(prLabelOfUrl("https://github.com/a/b/pull/7")).toBe("a/b#7");
    expect(prLabelOfUrl("nope")).toBe("nope");
  });
});

describe("bestState", () => {
  it("ranks merged > open > draft > closed", () => {
    expect(bestState([])).toBeUndefined();
    expect(bestState([{ state: "closed" }, { state: "draft" }])).toBe("draft");
    expect(bestState([{ state: "draft" }, { state: "open" }])).toBe("open");
    expect(bestState([{ state: "open" }, { state: "merged" }, { state: "closed" }])).toBe("merged");
  });
});

describe("toPrState / isStale", () => {
  it("maps", () => {
    expect(toPrState("OPEN", true)).toBe("draft");
    expect(toPrState("OPEN", false)).toBe("open");
    expect(toPrState("MERGED", true)).toBe("merged");
    expect(toPrState("CLOSED", false)).toBe("closed");
  });
  it("stale", () => {
    const e = { info: {} as never, fetchedAt: 1000 };
    expect(isStale(undefined, 0, 10)).toBe(true);
    expect(isStale(e, 1005, 10)).toBe(false);
    expect(isStale(e, 1010, 10)).toBe(true);
  });
});
