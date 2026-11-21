import { describe, expect, it } from "vitest";
import { defaultSettings } from "./defaults";
import { groupIssues, selectView, sortIssues } from "./query";
import type { Issue, Priority, Project } from "./types";

const settings = defaultSettings();

function mk(id: string, status: string, over: Partial<Issue> = {}): Issue {
  return {
    fileName: `${id}.md`, id, title: id, aliases: [], status, priority: "none", tags: [],
    pullRequests: [], description: "", feed: [],
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
