import { describe, expect, it } from "vitest";
import { defaultSettings } from "../../core/defaults";
import type { Issue } from "../../core/types";
import { buildIssueMenu, type MenuEntry } from "./issueMenuModel";

const issue = (over: Partial<Issue> = {}): Issue =>
  ({ id: "TIX-1", title: "T", status: "Backlog", priority: "high", tags: [], pullRequests: [], ...over }) as Issue;

const items = (entries: MenuEntry[]) => entries.filter((e): e is Extract<MenuEntry, { type: "item" }> => e.type === "item");
const labels = (entries: MenuEntry[]) => items(entries).map((e) => e.label);

describe("buildIssueMenu", () => {
  it("lists statuses and priorities with the current one checked", () => {
    const s = defaultSettings();
    const entries = buildIssueMenu(issue({ status: s.statuses[1]!.name, priority: "high" }), s);
    const status = items(entries).filter((e) => e.action.type === "status");
    expect(status).toHaveLength(s.statuses.length);
    expect(status.filter((e) => e.checked).map((e) => e.label)).toEqual([s.statuses[1]!.name]);
    const prio = items(entries).filter((e) => e.action.type === "priority");
    expect(prio.map((e) => e.label)).toEqual(["Urgent", "High", "Medium", "Low", "No priority"]);
    expect(prio.filter((e) => e.checked).map((e) => e.label)).toEqual(["High"]);
  });

  it("orders statuses by settings order", () => {
    const s = defaultSettings();
    const reversed = { ...s, statuses: [...s.statuses].reverse() };
    const names = items(buildIssueMenu(issue(), reversed)).filter((e) => e.action.type === "status").map((e) => e.label);
    expect(names).toEqual([...s.statuses].sort((a, b) => a.order - b.order).map((x) => x.name));
  });

  it("shows Milestone only when the issue has a project", () => {
    const s = defaultSettings();
    expect(labels(buildIssueMenu(issue(), s))).not.toContain("Milestone…");
    expect(labels(buildIssueMenu(issue({ project: "[[Web]]" }), s))).toContain("Milestone…");
  });

  it("ends with open, copy link and delete after separators", () => {
    const entries = buildIssueMenu(issue(), defaultSettings());
    const tail = entries.slice(-6).map((e) => (e.type === "item" ? e.label : e.type));
    expect(tail).toEqual(["Due date…", "separator", "Open in new tab", "Copy link", "separator", "Delete issue"]);
    expect(entries.at(-1)).toMatchObject({ type: "item", danger: true, action: { type: "delete" } });
  });
});
