import { describe, expect, it } from "vitest";
import { defaultSettings } from "./defaults";
import { defaultDisplay, mergeDisplay } from "./display";
import {
  buildView, filterCompleted, groupIssues, hideSubIssues, orderIssues, selectView, sortIssues, subGroup, subIssueCounts,
} from "./query";
import type { Issue, Priority, Project } from "./types";

const settings = defaultSettings();

function mk(id: string, status: string, over: Partial<Issue> = {}): Issue {
  return {
    fileName: `${id}.md`, id, title: id, aliases: [], status, priority: "none", tags: [],
    pullRequests: [], related: [], description: "", feed: [],
    raw: {} as Issue["raw"],
    ...over,
  };
}
const proj = (name: string): Project => ({ name } as Project);

describe("selectView", () => {
  const issues = [
    mk("T-1", "Backlog"), mk("T-2", "Todo"), mk("T-3", "In Progress", { project: "[[Alpha]]" }),
    mk("T-4", "Done"), mk("T-5", "Weird"), mk("T-6", "In Review", { project: "[[Beta]]" }),
  ];
  const ids = (l: Issue[]) => l.map((i) => i.id);
  it("all", () => expect(selectView(issues, "all", [])).toHaveLength(6));
  it("active = unstarted|started", () =>
    expect(ids(selectView(issues, "active", [], settings))).toEqual(["T-2", "T-3", "T-6"]));
  it("backlog", () => expect(ids(selectView(issues, "backlog", [], settings))).toEqual(["T-1"]));
  it("project", () => expect(ids(selectView(issues, "project:Alpha", [proj("Alpha")]))).toEqual(["T-3"]));
  it("project is case-insensitive", () => expect(ids(selectView(issues, "project:beta", [proj("Beta")]))).toEqual(["T-6"]));
});

describe("groupIssues", () => {
  it("orders groups by status order and omits empty ones", () => {
    const g = groupIssues([mk("a", "Done"), mk("b", "Triage"), mk("c", "Todo")], "status", settings);
    expect(g.map((x) => x.label)).toEqual(["Triage", "Todo", "Done"]);
  });
  it("showEmpty keeps all statuses", () => {
    expect(groupIssues([], "status", settings, { showEmpty: true })).toHaveLength(settings.statuses.length + 1);
  });
  it("unknown status goes to Other", () => {
    const g = groupIssues([mk("a", "Todo"), mk("b", "Nope")], "status", settings);
    expect(g.map((x) => x.label)).toEqual(["Todo", "Other"]);
    expect(g[1]!.issues[0]!.id).toBe("b");
  });
  it("none yields one group; empty input yields none", () => {
    expect(groupIssues([mk("a", "Todo")], "none", settings)).toHaveLength(1);
    expect(groupIssues([], "none", settings)).toHaveLength(0);
  });
});

describe("ordering", () => {
  it("priority then updated desc, none last", () => {
    const p = (id: string, priority: Priority, updated: string) => mk(id, "Todo", { priority, updated });
    const out = sortIssues([
      p("n", "none", "2026-01-09"), p("l", "low", "2026-01-01"), p("u1", "urgent", "2026-01-01"),
      p("u2", "urgent", "2026-02-01"), p("h", "high", "2026-01-01"),
    ]);
    expect(out.map((i) => i.id)).toEqual(["u2", "u1", "h", "l", "n"]);
  });
});

describe("performance", () => {
  it("selects and groups 1,000 issues quickly", () => {
    const names = settings.statuses.map((s) => s.name);
    const issues = Array.from({ length: 1000 }, (_, n) =>
      mk(`T-${n}`, names[n % names.length]!, { updated: `2026-01-${String(1 + (n % 28)).padStart(2, "0")}` }),
    );
    const t0 = performance.now();
    const g = groupIssues(selectView(issues, "all", []), "status", settings);
    const ms = performance.now() - t0;
    expect(g.reduce((n, x) => n + x.issues.length, 0)).toBe(1000);
    expect(ms).toBeLessThan(100);
  });
});

const labelsOf = (g: { label: string }[]) => g.map((x) => x.label);

describe("groupIssues by field", () => {
  const issues = [
    mk("T-1", "Todo", { priority: "low", project: "[[Beta]]", assignee: "zed", milestone: "M2", tags: ["b", "a"] }),
    mk("T-2", "Todo", { priority: "urgent", project: "[[alpha]]", assignee: "amy", milestone: "M1" }),
    mk("T-3", "Done", { priority: "none" }),
  ];
  it("priority: Urgent to Low then No priority, empty omitted", () => {
    const g = groupIssues(issues, "priority", settings);
    expect(labelsOf(g)).toEqual(["Urgent", "Low", "No priority"]);
    expect(g[0]!.key).toBe("priority:urgent");
  });
  it("priority showEmpty lists all five", () => {
    expect(groupIssues([], "priority", settings, { showEmpty: true })).toHaveLength(5);
  });
  it("project: alphabetical, No project last", () => {
    const g = groupIssues(issues, "project", settings);
    expect(labelsOf(g)).toEqual(["alpha", "Beta", "No project"]);
    expect(g[0]).toMatchObject({ key: "project:alpha", field: "project", value: "alpha" });
  });
  it("assignee: alphabetical, No assignee last", () => {
    expect(labelsOf(groupIssues(issues, "assignee", settings))).toEqual(["amy", "zed", "No assignee"]);
  });
  it("milestone: alphabetical, No milestone last", () => {
    expect(labelsOf(groupIssues(issues, "milestone", settings))).toEqual(["M1", "M2", "No milestone"]);
  });
  it("label: issue appears in each label group; unlabeled in No label", () => {
    const g = groupIssues(issues, "label", settings);
    expect(labelsOf(g)).toEqual(["a", "b", "No label"]);
    expect(g[0]!.issues.map((i) => i.id)).toEqual(["T-1"]);
    expect(g[1]!.issues.map((i) => i.id)).toEqual(["T-1"]);
    expect(g[2]!.issues.map((i) => i.id)).toEqual(["T-2", "T-3"]);
  });
  it("showEmpty lists known projects", () => {
    const projects = [{ name: "Gamma", milestones: [] }] as unknown as Project[];
    expect(labelsOf(groupIssues([], "project", settings, { showEmpty: true, projects }))).toEqual(["Gamma", "No project"]);
  });
  it("status group keys are stable", () => {
    expect(groupIssues([mk("a", "Todo")], "status", settings)[0]!.key).toBe("status:Todo");
  });
});

describe("subGroup", () => {
  const issues = [
    mk("T-1", "Todo", { priority: "high", project: "[[A]]" }),
    mk("T-2", "Todo", { priority: "high", project: "[[B]]" }),
    mk("T-3", "Todo", { priority: "high" }),
    mk("T-4", "Todo", { priority: "low", project: "[[A]]" }),
  ];
  it("nests sub-groups per group, keeping parent counts", () => {
    const g = subGroup(groupIssues(issues, "priority", settings), "project", settings);
    expect(g.map((x) => [x.label, x.issues.length])).toEqual([["High", 3], ["Low", 1]]);
    expect(labelsOf(g[0]!.subgroups!)).toEqual(["A", "B", "No project"]);
    expect(g[0]!.subgroups![0]!.key).toBe("priority:high/project:A");
    expect(labelsOf(g[1]!.subgroups!)).toEqual(["A"]);
  });
  it("none leaves groups untouched", () => {
    expect(subGroup(groupIssues(issues, "priority", settings), "none", settings)[0]!.subgroups).toBeUndefined();
  });
});

describe("orderIssues", () => {
  const a = mk("T-1", "Todo", { due: "2026-03-01", created: "2026-01-01T10:00:00", updated: "2026-01-05", sortOrder: 2 });
  const b = mk("T-2", "Todo", { due: "2026-02-01", created: "2026-01-02T10:00:00", updated: "2026-01-04", sortOrder: 1 });
  const c = mk("T-3", "Todo");
  const ids = (l: Issue[]) => l.map((i) => i.id);
  it("due: earliest first, no-due last", () => expect(ids(orderIssues([c, a, b], "due"))).toEqual(["T-2", "T-1", "T-3"]));
  it("created: newest first", () => expect(ids(orderIssues([c, a, b], "created"))).toEqual(["T-2", "T-1", "T-3"]));
  it("updated: newest first", () => expect(ids(orderIssues([c, b, a], "updated"))).toEqual(["T-1", "T-2", "T-3"]));
  it("manual: sortOrder asc, unset last", () => expect(ids(orderIssues([c, a, b], "manual"))).toEqual(["T-2", "T-1", "T-3"]));
  it("ties are stable regardless of input order", () => {
    const x = [mk("T-10", "Todo"), mk("T-2", "Todo"), mk("T-1", "Todo")];
    for (const o of ["manual", "priority", "updated", "created", "due"] as const) {
      expect(ids(orderIssues(x, o))).toEqual(["T-1", "T-2", "T-10"]);
      expect(ids(orderIssues([...x].reverse(), o))).toEqual(["T-1", "T-2", "T-10"]);
    }
  });
  it("does not mutate input", () => {
    const x = [c, a];
    orderIssues(x, "due");
    expect(ids(x)).toEqual(["T-3", "T-1"]);
  });
});

describe("filterCompleted", () => {
  const now = new Date(2026, 5, 10, 12, 0, 0);
  const DAY = 86400000;
  const at = (ms: number) => {
    const d = new Date(now.getTime() - ms);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const issues = [
    mk("open", "Todo", { updated: at(100 * DAY) }),
    mk("done-edge", "Done", { updated: at(7 * DAY) }),
    mk("done-old", "Done", { updated: at(7 * DAY + 1000) }),
    mk("canceled-new", "Canceled", { updated: at(DAY) }),
    mk("done-nodate", "Done"),
  ];
  const ids = (l: Issue[]) => l.map((i) => i.id);
  it("all keeps everything", () => expect(filterCompleted(issues, "all", now, settings)).toHaveLength(5));
  it("none drops completed and canceled", () => expect(ids(filterCompleted(issues, "none", now, settings))).toEqual(["open"]));
  it("week keeps exactly-7-days, drops older and undated", () =>
    expect(ids(filterCompleted(issues, "week", now, settings))).toEqual(["open", "done-edge", "canceled-new"]));
});

describe("hideSubIssues", () => {
  const issues = [mk("T-1", "Todo"), mk("T-2", "Todo", { parent: "T-1" }), mk("T-3", "Todo", { parent: "[[T-1]]" })];
  it("removes issues with a parent", () => expect(hideSubIssues(issues).map((i) => i.id)).toEqual(["T-1"]));
  it("counts sub-issues per parent", () => expect(subIssueCounts(issues).get("T-1")).toBe(2));
});

describe("buildView", () => {
  const now = new Date(2026, 5, 10);
  const issues = [
    mk("T-1", "Todo", { project: "[[A]]" }),
    mk("T-2", "Done", { project: "[[A]]", parent: "T-1" }),
    mk("T-3", "Todo"),
  ];
  it("applies the whole pipeline", () => {
    const d = { ...defaultDisplay(), showSubIssues: false, completed: "none" as const };
    const v = buildView(issues, "all", [], settings, d, undefined, now);
    expect(v.total).toBe(2);
    expect(v.groups.map((g) => g.label)).toEqual(["Todo"]);
  });
  it("reports sub-issue counts when hidden", () => {
    const d = { ...defaultDisplay(), showSubIssues: false };
    expect(buildView(issues, "all", [], settings, d, undefined, now).subCounts.get("T-1")).toBe(1);
  });
  it("sub-groups and filters", () => {
    const d = { ...defaultDisplay(), groupBy: "status" as const, subGroupBy: "project" as const };
    const v = buildView(issues, "all", [], settings, d, (i) => i.id !== "T-3", now);
    expect(v.groups.map((g) => g.subgroups!.length)).toEqual([1, 1]);
    expect(v.total).toBe(2);
  });
});

describe("mergeDisplay", () => {
  it("defaults on garbage and keeps valid values", () => {
    expect(mergeDisplay(null)).toEqual(defaultDisplay());
    const m = mergeDisplay({ groupBy: "priority", subGroupBy: "priority", orderBy: "bogus", properties: { id: false, x: true } });
    expect(m.groupBy).toBe("priority");
    expect(m.subGroupBy).toBe("none");
    expect(m.orderBy).toBe("priority");
    expect(m.properties.id).toBe(false);
  });
});
