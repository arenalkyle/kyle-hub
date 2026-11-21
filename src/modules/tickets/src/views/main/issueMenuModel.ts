import { PRIORITY_LABELS, PRIORITY_ORDER } from "../../../../../core/domain/defaults";
import type { Issue, Priority, Settings, StatusDef } from "../../../../../core/domain/types";

/** Pickers the context menu can open at the mouse position (same ones the S/P/L/A shortcuts use, plus project/milestone/due). */
export type PickerKind = "labels" | "assignee" | "project" | "milestone" | "due";

export type MenuAction =
  | { type: "status"; value: string }
  | { type: "priority"; value: Priority }
  | { type: "assignee"; value: string | null }
  | { type: "picker"; kind: PickerKind }
  | { type: "open"; newTab: boolean }
  | { type: "copyLink" }
  | { type: "delete" };

/** Icon of a menu item: the plugin's coloured icons, or a Lucide name for plain actions. */
export type MenuIcon =
  | { kind: "lucide"; name: string }
  | { kind: "status"; category: StatusDef["category"]; color: string }
  | { kind: "priority"; priority: Priority }
  | { kind: "avatar"; name: string };

export interface MenuItem {
  type: "item";
  label: string;
  icon: MenuIcon;
  action: MenuAction;
  checked?: boolean;
  danger?: boolean;
}

export type MenuEntry =
  | { type: "separator" }
  | { type: "heading"; label: string }
  | MenuItem
  | { type: "submenu"; label: string; icon: MenuIcon; children: MenuItem[] };

const lucide = (name: string): MenuIcon => ({ kind: "lucide", name });

/** Context menu for an issue row/card. Pure: no Obsidian or DOM access. `assignees` are extra known assignee names. */
export function buildIssueMenu(issue: Issue, settings: Settings, assignees: string[] = []): MenuEntry[] {
  const statuses = [...settings.statuses].sort((a, b) => a.order - b.order);
  const current = statuses.find((s) => s.name === issue.status);
  const names: string[] = [];
  for (const n of [issue.assignee, settings.displayName, ...assignees]) {
    const t = n?.trim();
    if (t && !names.some((x) => x.toLowerCase() === t.toLowerCase())) names.push(t);
  }
  const assigneeChildren: MenuItem[] = [
    { type: "item", label: "Unassign", icon: lucide("user-x"), checked: !issue.assignee, action: { type: "assignee", value: null } },
    ...names.map<MenuItem>((n) => ({
      type: "item",
      label: n,
      icon: { kind: "avatar", name: n },
      checked: n.toLowerCase() === issue.assignee?.trim().toLowerCase(),
      action: { type: "assignee", value: n },
    })),
  ];
  const entries: MenuEntry[] = [
    {
      type: "submenu",
      label: `Status: ${issue.status}`,
      icon: current ? { kind: "status", category: current.category, color: current.color } : lucide("circle"),
      children: statuses.map<MenuItem>((s) => ({
        type: "item",
        label: s.name,
        icon: { kind: "status", category: s.category, color: s.color },
        checked: s.name === issue.status,
        action: { type: "status", value: s.name },
      })),
    },
    {
      type: "submenu",
      label: `Priority: ${PRIORITY_LABELS[issue.priority]}`,
      icon: { kind: "priority", priority: issue.priority },
      children: PRIORITY_ORDER.map<MenuItem>((p) => ({
        type: "item",
        label: PRIORITY_LABELS[p],
        icon: { kind: "priority", priority: p },
        checked: p === issue.priority,
        action: { type: "priority", value: p },
      })),
    },
    {
      type: "submenu",
      label: `Assignee: ${issue.assignee?.trim() || "Unassigned"}`,
      icon: issue.assignee?.trim() ? { kind: "avatar", name: issue.assignee.trim() } : lucide("user"),
      children: assigneeChildren,
    },
    { type: "separator" },
    { type: "item", label: "Labels…", icon: lucide("tags"), action: { type: "picker", kind: "labels" } },
    { type: "item", label: "Project…", icon: lucide("folder"), action: { type: "picker", kind: "project" } },
  ];
  if (issue.project) entries.push({ type: "item", label: "Milestone…", icon: lucide("flag"), action: { type: "picker", kind: "milestone" } });
  entries.push(
    { type: "item", label: "Due date…", icon: lucide("calendar"), action: { type: "picker", kind: "due" } },
    { type: "separator" },
    { type: "item", label: "Open in new tab", icon: lucide("file-plus"), action: { type: "open", newTab: true } },
    { type: "item", label: "Copy link", icon: lucide("link"), action: { type: "copyLink" } },
    { type: "separator" },
    { type: "item", label: "Delete issue", icon: lucide("trash"), action: { type: "delete" }, danger: true },
  );
  return entries;
}
