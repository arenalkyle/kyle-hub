import { describe, expect, it } from "vitest";
import { clearUnlinked, findIssueIds, markUnlinked, planLinks } from "./prMatch";

describe("findIssueIds", () => {
  it("is case-insensitive and normalises separators", () => {
    expect(findIssueIds("TIX-12", "TIX")).toEqual(["TIX-12"]);
    expect(findIssueIds("tix-12", "TIX")).toEqual(["TIX-12"]);
    expect(findIssueIds("tix_12", "TIX")).toEqual(["TIX-12"]);
  });
  it("never matches partial numbers", () => {
    expect(findIssueIds("TIX-12 fix", "TIX")).not.toContain("TIX-1");
    expect(findIssueIds("TIX-123", "TIX")).toEqual(["TIX-123"]);
  });
  it("finds multiple ids and de-duplicates", () => {
    expect(findIssueIds("TIX-1 and TIX-2, again tix-1", "TIX")).toEqual(["TIX-1", "TIX-2"]);
  });
  it("matches ids in branch names", () => {
    expect(findIssueIds("feature/tix-7-x", "TIX")).toEqual(["TIX-7"]);
    expect(findIssueIds("tix-12-fix-login", "TIX")).toEqual(["TIX-12"]);
  });
  it("requires a word boundary before the prefix", () => {
    expect(findIssueIds("MATIX-5 SUBTIX_5", "TIX")).toEqual([]);
  });
  it("escapes regex characters in the prefix and ignores an empty prefix", () => {
    expect(findIssueIds("A.B-1 AxB-1", "A.B")).toEqual(["A.B-1"]);
    expect(findIssueIds("TIX-1", "")).toEqual([]);
  });
});

describe("planLinks", () => {
  const issues = [
    { id: "TIX-1", pullRequests: [] as string[] },
    { id: "TIX-12", pullRequests: ["https://github.com/o/r/pull/2"] },
  ];
  const pr = (n: number, title: string, headRefName = "") => ({ url: `https://github.com/o/r/pull/${n}`, title, headRefName });
  it("links by title and branch, skipping partial numbers", () => {
    expect(planLinks([pr(1, "TIX-1 test"), pr(3, "x", "tix-12-fix")], issues, {}, "TIX")).toEqual([
      { issueId: "TIX-1", url: "https://github.com/o/r/pull/1" },
      { issueId: "TIX-12", url: "https://github.com/o/r/pull/3" },
    ]);
    expect(planLinks([pr(5, "TIX-12 only")], issues, {}, "TIX").map((l) => l.issueId)).toEqual(["TIX-12"]);
  });
  it("skips already linked, unlinked and unknown ids", () => {
    expect(planLinks([pr(2, "TIX-12")], issues, {}, "TIX")).toEqual([]);
    expect(planLinks([pr(1, "TIX-1")], issues, { "TIX-1": ["https://github.com/o/r/pull/1"] }, "TIX")).toEqual([]);
    expect(planLinks([pr(9, "TIX-99")], issues, {}, "TIX")).toEqual([]);
  });
  it("de-duplicates a PR seen twice", () => {
    expect(planLinks([pr(1, "TIX-1"), pr(1, "TIX-1", "tix-1-a")], issues, {}, "TIX")).toHaveLength(1);
  });
});

describe("unlinked helpers", () => {
  it("marks and clears", () => {
    const u = markUnlinked({}, "TIX-1", "https://github.com/o/r/pull/1/files");
    expect(u).toEqual({ "TIX-1": ["https://github.com/o/r/pull/1"] });
    expect(markUnlinked(u, "TIX-1", "https://github.com/o/r/pull/1")).toBe(u);
    expect(clearUnlinked(u, "TIX-1", "https://github.com/o/r/pull/1")).toEqual({});
  });
});
