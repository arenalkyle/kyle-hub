import { describe, expect, it } from "vitest";
import { dropToPatch, needsRebalance, planReorder, sortOrderBetween } from "./dnd";
import { OTHER_GROUP_KEY } from "./query";
import type { Issue } from "./types";

const issue = (o: Partial<Issue> = {}): Issue =>
  ({ id: "LOCK-1", title: "t", status: "Todo", priority: "none", tags: ["a", "b"], aliases: [], pullRequests: [], ...o }) as Issue;

describe("dropToPatch", () => {
  it("status", () => {
    expect(dropToPatch("status", "none", { group: "status:Todo" }, { group: "status:Done" }, issue())).toEqual({ status: "Done" });
  });
  it("same cell is an empty patch", () => {
    expect(dropToPatch("status", "none", { group: "status:Todo" }, { group: "status:Todo" }, issue())).toEqual({});
  });
  it("Other status group is impossible", () => {
    expect(dropToPatch("status", "none", { group: "status:Todo" }, { group: OTHER_GROUP_KEY }, issue())).toBeNull();
  });
  it("priority incl. none", () => {
    expect(dropToPatch("priority", "none", { group: "priority:low" }, { group: "priority:urgent" }, issue())).toEqual({ priority: "urgent" });
    expect(dropToPatch("priority", "none", { group: "priority:low" }, { group: "priority:none" }, issue())).toEqual({ priority: "none" });
    expect(dropToPatch("priority", "none", { group: "priority:low" }, { group: "priority:bogus" }, issue())).toBeNull();
  });
  it("project set and cleared", () => {
    expect(dropToPatch("project", "none", { group: "none:project" }, { group: "project:Alpha" }, issue())).toEqual({ project: "Alpha" });
    expect(dropToPatch("project", "none", { group: "project:Alpha" }, { group: "none:project" }, issue())).toEqual({ project: null });
  });
  it("assignee and milestone", () => {
    expect(dropToPatch("assignee", "none", { group: "assignee:kyle" }, { group: "none:assignee" }, issue())).toEqual({ assignee: null });
    expect(dropToPatch("milestone", "none", { group: "none:milestone" }, { group: "milestone:M1" }, issue())).toEqual({ milestone: "M1" });
  });
  it("label moves the dragged-from label to the target", () => {
    expect(dropToPatch("label", "none", { group: "label:a" }, { group: "label:c" }, issue())).toEqual({ tags: ["b", "c"] });
    expect(dropToPatch("label", "none", { group: "label:a" }, { group: "none:label" }, issue())).toEqual({ tags: ["b"] });
    expect(dropToPatch("label", "none", { group: "none:label" }, { group: "label:z" }, issue({ tags: [] }))).toEqual({ tags: ["z"] });
    expect(dropToPatch("label", "none", { group: "label:a" }, { group: "label:b" }, issue())).toEqual({ tags: ["b"] });
  });
  it("wrong-field key is impossible", () => {
    expect(dropToPatch("project", "none", { group: "project:A" }, { group: "status:Done" }, issue())).toBeNull();
  });
  it("none grouping has no field mapping but same cell is fine", () => {
    expect(dropToPatch("none", "none", { group: "none" }, { group: "none" }, issue())).toEqual({});
  });
  it("swimlanes update both fields", () => {
    expect(
      dropToPatch("project", "priority", { group: "project:A", sub: "priority:low" }, { group: "project:B", sub: "priority:high" }, issue()),
    ).toEqual({ project: "B", priority: "high" });
    expect(
      dropToPatch("status", "project", { group: "status:Todo", sub: "project:A" }, { group: "status:Todo", sub: "none:project" }, issue()),
    ).toEqual({ project: null });
  });
  it("sub dimension can be impossible", () => {
    expect(dropToPatch("status", "priority", { group: "status:Todo", sub: "priority:low" }, { group: "status:Todo", sub: "x" }, issue())).toBeNull();
  });
});

describe("sortOrderBetween", () => {
  it("midpoints and open ends", () => {
    expect(sortOrderBetween()).toBe(1000);
    expect(sortOrderBetween(1000)).toBe(2000);
    expect(sortOrderBetween(undefined, 1000)).toBe(0);
    expect(sortOrderBetween(1000, 2000)).toBe(1500);
  });
  it("detects exhausted gaps", () => {
    expect(needsRebalance(1, 1 + 1e-9)).toBe(true);
    expect(needsRebalance(1, 2)).toBe(false);
    expect(needsRebalance(undefined, 2)).toBe(false);
  });
});

describe("planReorder", () => {
  it("only the moved item changes normally", () => {
    const l = [{ id: "a", sortOrder: 1000 }, { id: "m" }, { id: "b", sortOrder: 2000 }];
    expect(planReorder(l, "m")).toEqual({ m: 1500 });
  });
  it("moves to the end", () => {
    expect(planReorder([{ id: "a", sortOrder: 1000 }, { id: "m", sortOrder: 5 }], "m")).toEqual({ m: 2000 });
  });
  it("renumbers when the gap is exhausted", () => {
    const l = [{ id: "a", sortOrder: 1 }, { id: "m" }, { id: "b", sortOrder: 1 + 1e-9 }];
    expect(planReorder(l, "m")).toEqual({ a: 1000, m: 2000, b: 3000 });
  });
  it("renumbers when the previous neighbour has no order", () => {
    expect(planReorder([{ id: "a" }, { id: "m" }], "m")).toEqual({ a: 1000, m: 2000 });
  });
  it("moving before unordered items needs no renumber", () => {
    expect(planReorder([{ id: "m" }, { id: "a" }], "m")).toEqual({ m: 1000 });
  });
});

describe("dropToPatch multi-word group values (LOCK-31)", () => {
  it("drops into In Progress and In Review", () => {
    expect(dropToPatch("status", "none", { group: "status:Todo" }, { group: "status:In Progress" }, issue())).toEqual({ status: "In Progress" });
    expect(dropToPatch("status", "none", { group: "status:Todo" }, { group: "status:In Review" }, issue())).toEqual({ status: "In Review" });
  });
  it("multi-word values in swimlanes", () => {
    expect(
      dropToPatch("status", "priority", { group: "status:Todo", sub: "priority:low" }, { group: "status:In Progress", sub: "priority:high" }, issue()),
    ).toEqual({ status: "In Progress", priority: "high" });
    expect(
      dropToPatch("project", "status", { group: "project:Big Launch", sub: "status:Todo" }, { group: "project:Big Launch", sub: "status:In Review" }, issue()),
    ).toEqual({ status: "In Review" });
  });
  it("multi-word project and label values", () => {
    expect(dropToPatch("project", "none", { group: "none:project" }, { group: "project:Big Launch" }, issue())).toEqual({ project: "Big Launch" });
    expect(dropToPatch("label", "none", { group: "label:a" }, { group: "label:needs review" }, issue())).toEqual({ tags: ["b", "needs review"] });
  });
});
