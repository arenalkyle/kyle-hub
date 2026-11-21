import type { Priority, Settings, StatusDef } from "./types";

export const DEFAULT_STATUSES: StatusDef[] = [
  { name: "Triage", category: "triage", color: "#fc7840", order: 0 },
  { name: "Backlog", category: "backlog", color: "#bec2c8", order: 1 },
  { name: "Todo", category: "unstarted", color: "#e2e2e2", order: 2 },
  { name: "In Progress", category: "started", color: "#f2c94c", order: 3 },
  { name: "In Review", category: "started", color: "#0f783c", order: 4 },
  { name: "Done", category: "completed", color: "#5e6ad2", order: 5 },
  { name: "Canceled", category: "canceled", color: "#95a2b3", order: 6 },
  { name: "Duplicate", category: "canceled", color: "#95a2b3", order: 7 },
];

export const DEFAULT_STATUS_NAME = "Backlog";

/** Sort order: most urgent first, `none` last. */
export const PRIORITY_ORDER: Priority[] = ["urgent", "high", "medium", "low", "none"];

export const PRIORITY_LABELS: Record<Priority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "No priority",
};

export function defaultSettings(): Settings {
  return {
    folder: "Tickets",
    prefix: "TIX",
    displayName: "kyle",
    statuses: DEFAULT_STATUSES.map((s) => ({ ...s })),
    defaultStatus: DEFAULT_STATUS_NAME,
    labelColors: {},
    ghRepos: [],
    autoLinkPrs: false,
    unlinkedPrs: {},
    prRefreshMinutes: 10,
    ghPath: "",
  };
}
