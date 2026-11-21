import type { Issue, Project, StatusCategory, StatusDef } from "./types";

export const TICKET_TYPES = ["task", "bug", "plan", "proposal", "question", "finding"] as const;
export type TicketType = (typeof TICKET_TYPES)[number];
export const MODELS = ["haiku", "sonnet", "opus"] as const;
export type Model = (typeof MODELS)[number];
export const OUTCOMES = ["success", "partial", "failed", "abandoned"] as const;
export type Outcome = (typeof OUTCOMES)[number];
/** `human`, `agent:<session>` or `agent:retro`. */
export type Source = "human" | "agent:retro" | `agent:${string}`;

export const DEFAULT_TYPE: TicketType = "task";

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  return (list as readonly string[]).includes(s) ? (s as T) : undefined;
};

export const parseType = (v: unknown): TicketType | undefined => oneOf(TICKET_TYPES, v);
export const parseModel = (v: unknown): Model | undefined => oneOf(MODELS, v);
export const parseOutcome = (v: unknown): Outcome | undefined => oneOf(OUTCOMES, v);

export function parseSource(v: unknown): Source | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (s === "human" || s === "agent:retro") return s;
  return /^agent:\S+$/.test(s) ? (s as Source) : undefined;
}

export function parseCost(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** Ticket type with the `task` default applied. */
export const effectiveType = (issue: Pick<Issue, "type">): TicketType => issue.type ?? DEFAULT_TYPE;

/** Ticket repo, else its project's repo (tickets inherit from projects). */
export function effectiveRepo(ticket: Pick<Issue, "repo">, project?: Pick<Project, "repo">): string | undefined {
  return ticket.repo ?? project?.repo;
}

/** One entry of the `core.repos` settings map (key = a ticket's `repo`). */
export interface RepoConfig {
  path: string;
  github?: string;
  profile: "work" | "home";
  worktrees: boolean;
}

/** Category of a status name; undefined when the name is unknown. */
export function categoryOf(status: string, statuses: readonly StatusDef[]): StatusCategory | undefined {
  return statuses.find((s) => s.name === status)?.category;
}
