import type { Document } from "yaml";

export type StatusCategory =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled";

export type Priority = "none" | "urgent" | "high" | "medium" | "low";

export type ProjectStatus =
  | "backlog"
  | "planned"
  | "started"
  | "paused"
  | "completed"
  | "canceled";

export interface StatusDef {
  name: string;
  category: StatusCategory;
  color: string;
  order: number;
}

/** `time` is local `YYYY-MM-DD HH:mm`. */
export interface Comment {
  type: "comment";
  author: string;
  time: string;
  body: string;
}

export interface ActivityEvent {
  type: "event";
  author: string;
  time: string;
  text: string;
}

export type FeedEntry = Comment | ActivityEvent;

/** Raw pieces kept so unchanged files serialize byte-for-byte. */
export interface RawParts {
  /** Frontmatter text between the `---` fences (no fences), as read. */
  frontmatterText: string;
  doc: Document;
  /** Everything from the line after the closing fence up to `## Activity`. */
  descriptionRaw: string;
  /** From the `## Activity` heading line to EOF, or null if absent. */
  feedRaw: string | null;
  eol: string;
}

export interface Issue {
  fileName: string;
  id: string;
  title: string;
  /** Kept in sync with `title` by `applyPatch`. */
  aliases: string[];
  status: string;
  priority: Priority;
  assignee?: string;
  /** Stored as `"[[Name]]"`; see `fromLink`. */
  project?: string;
  milestone?: string;
  tags: string[];
  due?: string;
  parent?: string;
  pullRequests: string[];
  created?: string;
  updated?: string;
  updatedBy?: string;
  sortOrder?: number;
  /** Markdown description (body before `## Activity`), trimmed of edge blank lines. */
  description: string;
  feed: FeedEntry[];
  raw: RawParts;
}

export interface Milestone {
  name: string;
  target?: string;
  description?: string;
}

export interface Project {
  fileName: string;
  name: string;
  status: ProjectStatus;
  lead?: string;
  target?: string;
  color?: string;
  icon?: string;
  milestones: Milestone[];
  /** Markdown body after the frontmatter. */
  description: string;
  raw: { frontmatterText: string; doc: Document; eol: string; bodyRaw: string };
}

export interface Settings {
  folder: string;
  prefix: string;
  displayName: string;
  statuses: StatusDef[];
  defaultStatus: string;
  labelColors: Record<string, string>;
  ghRepos: string[];
  prRefreshMinutes: number;
}
