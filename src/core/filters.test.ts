import { describe, expect, it } from "vitest";
import { defaultSettings } from "./defaults";
import { defaultDisplay } from "./display";
import { applyFilters, mergeFilters, NONE_VALUE, setFilterValues, type Filter } from "./filters";
import { buildView } from "./query";
import type { Issue } from "./types";

const settings = defaultSettings();
function mk(id: string, status: string, over: Partial<Issue> = {}): Issue {
  return {
    fileName: `${id}.md`, id, title: id, aliases: [], status, priority: "none", tags: [],
    pullRequests: [], description: "", feed: [], raw: {} as Issue["raw"], ...over,
  };
}
const ids = (l: Issue[]) => l.map((i) => i.id);
const run = (issues: Issue[], f: Filter[], now = new Date(2026, 5, 10, 15)) => ids(applyFilters(issues, f, now, settings));
const f = (field: Filter["field"], values: string[], op: Filter["op"] = "in"): Filter => ({ field, op, values });

describe("applyFilters fields", () => {
  const issues = [
    mk("A", "Todo", { priority: "high", project: "[[P1]]", milestone: "[[M1]]", assignee: "kyle", tags: ["bug"] }),
    mk("B", "Done", { priority: "none", tags: ["bug", "ui"] }),
    mk("C", "In Progress", { priority: "low", project: "[[P2]]", assignee: "sam", tags: ["ui"] }),
  ];
  it("status in / notIn", () => {
    expect(run(issues, [f("status", ["Todo", "Done"])])).toEqual(["A", "B"]);
    expect(run(issues, [f("status", ["Todo", "Done"], "notIn")])).toEqual(["C"]);
  });
  it("priority incl. none", () => {
    expect(run(issues, [f("priority", ["high", "none"])])).toEqual(["A", "B"]);
    expect(run(issues, [f("priority", ["none"], "notIn")])).toEqual(["A", "C"]);
  });
  it("project incl. No project", () => {
    expect(run(issues, [f("project", ["P1"])])).toEqual(["A"]);
    expect(run(issues, [f("project", [NONE_VALUE])])).toEqual(["B"]);
    expect(run(issues, [f("project", ["P1", NONE_VALUE])])).toEqual(["A", "B"]);
    expect(run(issues, [f("project", ["P1"], "notIn")])).toEqual(["B", "C"]);
  });
  it("milestone incl. No milestone", () => {
    expect(run(issues, [f("milestone", ["M1"])])).toEqual(["A"]);
    expect(run(issues, [f("milestone", [NONE_VALUE])])).toEqual(["B", "C"]);
  });
  it("assignee incl. No assignee", () => {
    expect(run(issues, [f("assignee", ["sam"])])).toEqual(["C"]);
    expect(run(issues, [f("assignee", [NONE_VALUE])])).toEqual(["B"]);
    expect(run(issues, [f("assignee", ["kyle"], "notIn")])).toEqual(["B", "C"]);
  });
  it("label in = any, notIn = none of them, No label", () => {
    expect(run(issues, [f("label", ["bug"])])).toEqual(["A", "B"]);
    expect(run(issues, [f("label", ["bug", "ui"])])).toEqual(["A", "B", "C"]);
    expect(run(issues, [f("label", ["bug"], "notIn")])).toEqual(["C"]);
    expect(run(issues, [f("label", ["bug", "ui"], "notIn")])).toEqual([]);
    expect(run([...issues, mk("D", "Todo")], [f("label", [NONE_VALUE])])).toEqual(["D"]);
  });
  it("AND combination and empty values ignored", () => {
    expect(run(issues, [f("status", ["Todo", "Done"]), f("label", ["ui"])])).toEqual(["B"]);
    expect(run(issues, [f("status", [])])).toHaveLength(3);
  });
});

describe("due filter (now = Wed 2026-06-10)", () => {
  const d = (id: string, due: string | undefined, status = "Todo") => mk(id, status, { due });
  const issues = [
    d("yest", "2026-06-09"), d("today", "2026-06-10"), d("mon", "2026-06-08"), d("sun", "2026-06-14"),
    d("nextMon", "2026-06-15"), d("prevSun", "2026-06-07"), d("eom", "2026-06-30"), d("jul", "2026-07-01"),
    d("none", undefined), d("doneOld", "2026-06-01", "Done"),
  ];
  it("overdue excludes completed and today", () =>
    expect(run(issues, [f("due", ["overdue"])])).toEqual(["yest", "mon", "prevSun"]));
  it("today", () => expect(run(issues, [f("due", ["today"])])).toEqual(["today"]));
  it("week runs Monday-Sunday", () =>
    expect(run(issues, [f("due", ["week"])])).toEqual(["yest", "today", "mon", "sun"]));
  it("week edge: now on Sunday", () =>
    expect(run(issues, [f("due", ["week"])], new Date(2026, 5, 14, 23, 59))).toEqual(["yest", "today", "mon", "sun"]));
  it("week edge: now on Monday", () =>
    expect(run(issues, [f("due", ["week"])], new Date(2026, 5, 8))).toEqual(["yest", "today", "mon", "sun"]));
  it("month", () =>
    expect(run(issues, [f("due", ["month"])])).toEqual(["yest", "today", "mon", "sun", "nextMon", "prevSun", "eom", "doneOld"]));
  it("none and notIn", () => {
    expect(run(issues, [f("due", ["none"])])).toEqual(["none"]);
    expect(run(issues, [f("due", ["none"], "notIn")])).toHaveLength(9);
  });
});

describe("persistence helpers", () => {
  it("mergeFilters drops invalid entries", () => {
    expect(
      mergeFilters([f("status", ["Todo"]), { field: "x", op: "in", values: ["a"] }, f("due", ["bogus"]), { field: "label", op: "?", values: [] }, 3]),
    ).toEqual([f("status", ["Todo"])]);
    expect(mergeFilters(undefined)).toEqual([]);
  });
  it("setFilterValues upserts and removes, keeping op", () => {
    const a = setFilterValues([], "label", ["x"]);
    const b = setFilterValues([{ ...a[0]!, op: "notIn" }], "label", ["x", "y"]);
    expect(b).toEqual([f("label", ["x", "y"], "notIn")]);
    expect(setFilterValues(b, "label", [])).toEqual([]);
  });
});

describe("buildView with filters", () => {
  it("filters before grouping so counts update", () => {
    const issues = [mk("A", "Todo", { tags: ["bug"] }), mk("B", "Todo"), mk("C", "Done", { tags: ["bug"] })];
    const v = buildView(issues, "all", [], settings, defaultDisplay(), [f("label", ["bug"])], new Date(2026, 5, 10));
    expect(v.total).toBe(2);
    expect(v.groups.map((g) => g.issues.length)).toEqual([1, 1]);
  });
});
