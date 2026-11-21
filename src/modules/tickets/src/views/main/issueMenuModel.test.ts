import { describe, expect, it } from "vitest";
import { defaultSettings } from "../../../../../core/domain/defaults";
import type { Issue } from "../../../../../core/domain/types";
import { buildIssueMenu, type MenuEntry, type MenuItem } from "./issueMenuModel";

const issue = (over: Partial<Issue> = {}): Issue =>
  ({ id: "TIX-1", title: "T", status: "Backlog", priority: "high", tags: [], pullRequests: [], ...over }) as Issue;

const items = (entries: MenuEntry[]) => entries.filter((e): e is MenuItem => e.type === "item");
const labels = (entries: MenuEntry[]) => items(entries).map((e) => e.label);
const sub = (entries: MenuEntry[], prefix: string) =>
  entries.find((e): e is Extract<MenuEntry, { type: "submenu" }> => e.type === "submenu" && e.label.startsWith(prefix))!;

describe("buildIssueMenu", () => {
  it("lists statuses and priorities in submenus with the current one checked and coloured icons", () => {
    const s = defaultSettings();
    const entries = buildIssueMenu(issue({ status: s.statuses[1]!.name, priority: "high" }), s);
    const status = sub(entries, "Status").children;
    expect(status).toHaveLength(s.statuses.length);
    expect(status.filter((e) => e.checked).map((e) => e.label)).toEqual([s.statuses[1]!.name]);
    expect(status[0]!.icon).toMatchObject({ kind: "status", color: s.statuses[0]!.color });
    const prio = sub(entries, "Priority").children;
    expect(prio.map((e) => e.label)).toEqual(["Urgent", "High", "Medium", "Low", "No priority"]);
    expect(prio.filter((e) => e.checked).map((e) => e.label)).toEqual(["High"]);
    expect(prio[0]!.icon).toEqual({ kind: "priority", priority: "urgent" });
  });

  it("orders statuses by settings order", () => {
    const s = defaultSettings();
    const reversed = { ...s, statuses: [...s.statuses].reverse() };
    const names = sub(buildIssueMenu(issue(), reversed), "Status").children.map((e) => e.label);
    expect(names).toEqual([...s.statuses].sort((a, b) => a.order - b.order).map((x) => x.name));
  });

  it("shows the current assignee and offers unassign plus known assignees", () => {
    const s = defaultSettings();
    const a = sub(buildIssueMenu(issue({ assignee: "Ann" }), s, ["Bob", "ann"]), "Assignee");
    expect(a.label).toBe("Assignee: Ann");
    expect(a.icon).toEqual({ kind: "avatar", name: "Ann" });
    expect(a.children[0]).toMatchObject({ label: "Unassign", action: { type: "assignee", value: null } });
    expect(a.children.filter((c) => c.checked).map((c) => c.label)).toEqual(["Ann"]);
    expect(a.children.map((c) => c.label)).toContain("Bob");
    expect(sub(buildIssueMenu(issue(), s), "Assignee").label).toBe("Assignee: Unassigned");
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
