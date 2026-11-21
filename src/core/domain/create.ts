import { stringify } from "yaml";
import { assemble } from "./frontmatter";
import { formatIso } from "./time";
import type { Milestone, Priority, ProjectStatus } from "./types";
import { toLink } from "./links";

export interface NewIssueInput {
  title: string;
  status?: string;
  priority?: Priority;
  assignee?: string;
  project?: string;
  milestone?: string;
  tags?: string[];
  due?: string;
  parent?: string;
  pullRequests?: string[];
  description?: string;
  sortOrder?: number;
  linearId?: string;
  created?: Date;
  updated?: Date;
}

export interface NewProjectInput {
  name: string;
  status?: ProjectStatus;
  lead?: string;
  target?: string;
  color?: string;
  icon?: string;
  milestones?: Milestone[];
  description?: string;
}

/** Accepts `Name` or `[[Name]]`; always returns `[[Name]]`. */
export function asLink(v: string): string {
  return v.trim().startsWith("[[") ? v.trim() : toLink(v.trim());
}

/** Frontmatter + description for a brand-new ticket (no activity section yet). */
export function buildIssueText(id: string, input: NewIssueInput, defaultStatus: string, now: Date): string {
  const fm: Record<string, unknown> = { id, title: input.title, aliases: [input.title] };
  fm.status = input.status ?? defaultStatus;
  if (input.priority && input.priority !== "none") fm.priority = input.priority;
  if (input.assignee) fm.assignee = input.assignee;
  if (input.project) fm.project = asLink(input.project);
  if (input.milestone) fm.milestone = input.milestone;
  if (input.tags?.length) fm.tags = input.tags;
  if (input.due) fm.due = input.due;
  if (input.parent) fm.parent = asLink(input.parent);
  if (input.pullRequests?.length) fm.pullRequests = input.pullRequests;
  if (input.linearId) fm.linearId = input.linearId;
  fm.created = formatIso(input.created ?? now);
  fm.updated = formatIso(input.updated ?? now);
  if (input.sortOrder !== undefined) fm.sortOrder = input.sortOrder;
  const text = stringify(fm, { lineWidth: 0, flowCollectionPadding: false }).replace(/\n$/, "");
  const desc = (input.description ?? "").trim();
  return assemble(text, "\n", desc === "" ? "" : desc + "\n");
}

export function buildProjectText(input: NewProjectInput): string {
  const fm: Record<string, unknown> = { kind: "kt-project", name: input.name };
  fm.status = input.status ?? "backlog";
  if (input.lead) fm.lead = input.lead;
  if (input.target) fm.target = input.target;
  if (input.color) fm.color = input.color;
  if (input.icon) fm.icon = input.icon;
  if (input.milestones?.length) fm.milestones = input.milestones;
  const text = stringify(fm, { lineWidth: 0 }).replace(/\n$/, "");
  const desc = (input.description ?? "").trim();
  return assemble(text, "\n", desc === "" ? "" : desc + "\n");
}

