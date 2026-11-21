import type { StatusCategory, StatusDef } from "./types";
import { AGENT_READY } from "./gates";

export const BASE_FILES = ["Triage.base", "Queue.base", "Proposals.base", "Blocked.base"] as const;

const COLUMNS = ["id", "title", "status", "type", "repo", "priority", "source", "created"];

const statusIs = (statuses: readonly StatusDef[], categories: readonly StatusCategory[]): string[] =>
  statuses.filter((s) => categories.includes(s.category)).map((s) => `status == "${s.name.replace(/"/g, '\\"')}"`);

function base(folder: string, name: string, extra: string[], sort: "created" | "updated" = "created"): string {
  return [
    "filters:",
    "  and:",
    `    - file.inFolder("${folder}/Issues")`,
    ...extra,
    "views:",
    "  - type: table",
    `    name: ${name}`,
    "    order:",
    ...COLUMNS.map((c) => `      - ${c}`),
    "    sort:",
    `      - property: ${sort}`,
    "        direction: DESC",
    "",
  ].join("\n");
}

const anyOf = (conds: string[]): string[] => (conds.length === 0 ? ['    - "false"'] : ["    - or:", ...conds.map((c) => `        - ${c}`)]);

/** Generated `.base` slices; the Obsidian Bases format matches the existing `All Issues.base`. */
export function baseSlices(folder: string, statuses: readonly StatusDef[]): Record<(typeof BASE_FILES)[number], string> {
  const open = statuses.filter((s) => s.category !== "completed" && s.category !== "canceled");
  return {
    "Triage.base": base(folder, "Triage", anyOf(statusIs(statuses, ["triage"]))),
    "Queue.base": base(folder, "Queue", [`    - tags.contains("${AGENT_READY}")`, ...anyOf(statusIs(statuses, ["unstarted"]))]),
    "Proposals.base": base(folder, "Proposals", [
      '    - type == "proposal"',
      ...anyOf(open.map((s) => `status == "${s.name.replace(/"/g, '\\"')}"`)),
    ]),
    "Blocked.base": base(folder, "Blocked", [
      "    - blockedBy.length > 0",
      ...anyOf(open.map((s) => `status == "${s.name.replace(/"/g, '\\"')}"`)),
    ]),
  };
}
