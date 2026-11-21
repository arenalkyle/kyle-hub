import { PRIORITY_LABELS, PRIORITY_ORDER } from "../../core/defaults";
import type { Issue, Priority, Settings, StatusDef } from "../../core/types";

/** Pickers the context menu can open at the mouse position (same ones the S/P/L/A shortcuts use, plus project/milestone/due). */
export type PickerKind = "labels" | "assignee" | "project" | "milestone" | "due";

export type MenuAction =
  | { type: "status"; value: string }
  | { type: "priority"; value: Priority }
  | { type: "picker"; kind: PickerKind }
  | { type: "open"; newTab: boolean }
  | { type: "copyLink" }
  | { type: "delete" };

export type MenuEntry =
  | { type: "separator" }
  | { type: "heading"; label: string }
  | { type: "item"; label: string; icon: string; action: MenuAction; checked?: boolean; danger?: boolean };

/** Lucide icon per status category (Obsidian menus cannot host the React status SVGs). */
const STATUS_ICON: Record<StatusDef["category"], string> = {
  triage: "circle-help",
  backlog: "circle-dashed",
  unstarted: "circle",
  started: "circle-dot",
  completed: "circle-check",
  canceled: "circle-x",
};

const PRIORITY_ICON: Record<Priority, string> = {
  urgent: "alert-triangle",
  high: "chevrons-up",
  medium: "chevron-up",
  low: "chevron-down",
  none: "minus",
};

/** Context menu for an issue row/card. Pure: no Obsidian or DOM access. */
export function buildIssueMenu(issue: Issue, settings: Settings): MenuEntry[] {
  const statuses = [...settings.statuses].sort((a, b) => a.order - b.order);
  const entries: MenuEntry[] = [
    { type: "heading", label: "Status" },
    ...statuses.map<MenuEntry>((s) => ({
      type: "item",
      label: s.name,
      icon: STATUS_ICON[s.category],
      checked: s.name === issue.status,
      action: { type: "status", value: s.name },
    })),
    { type: "separator" },
    { type: "heading", label: "Priority" },
    ...PRIORITY_ORDER.map<MenuEntry>((p) => ({
      type: "item",
      label: PRIORITY_LABELS[p],
      icon: PRIORITY_ICON[p],
      checked: p === issue.priority,
      action: { type: "priority", value: p },
    })),
    { type: "separator" },
    { type: "item", label: "Assignee…", icon: "user", action: { type: "picker", kind: "assignee" } },
    { type: "item", label: "Labels…", icon: "tags", action: { type: "picker", kind: "labels" } },
    { type: "item", label: "Project…", icon: "folder", action: { type: "picker", kind: "project" } },
  ];
  if (issue.project) entries.push({ type: "item", label: "Milestone…", icon: "flag", action: { type: "picker", kind: "milestone" } });
  entries.push(
    { type: "item", label: "Due date…", icon: "calendar", action: { type: "picker", kind: "due" } },
    { type: "separator" },
    { type: "item", label: "Open in new tab", icon: "file-plus", action: { type: "open", newTab: true } },
    { type: "item", label: "Copy link", icon: "link", action: { type: "copyLink" } },
    { type: "separator" },
    { type: "item", label: "Delete issue", icon: "trash", action: { type: "delete" }, danger: true },
  );
  return entries;
}
