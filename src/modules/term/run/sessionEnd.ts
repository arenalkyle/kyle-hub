import type { Outcome } from "../../../core/domain/fields";
import { categoryOf } from "../../../core/domain/fields";
import { parseAcceptance } from "../../../core/domain/acceptance";
import type { Comment, Issue, StatusDef } from "../../../core/domain/types";
import type { IngestOptions, LogService, RunIndexEntry } from "../../../core/logs/types";
import type { GitPort } from "../launch/launch";
import { defaultBranch } from "../launch/launch";
import { mechanicalSummary } from "./mechanical";
import type { RunInfo } from "./runs";

/** Reserved author of plugin-written comments; never counts as an agent summary. */
export const PLUGIN_AUTHOR = "kyle-hub";
/** Closed within this long with no commits = abandoned. */
export const ABANDON_MS = 2 * 60_000;

export interface EndTickets {
  get(id: string): Issue | undefined;
  update(id: string, patch: { status?: string; outcome?: Outcome; costUsd?: number }, actor?: { author?: string }): Promise<Issue>;
  comment(id: string, body: string, actor?: { author?: string }): Promise<Issue>;
  logEvent(id: string, text: string, actor?: { author?: string }): Promise<Issue>;
  statuses(): StatusDef[];
}

export type EndLogs = Pick<LogService, "runs" | "annotateRun"> & { ingest(opts?: IngestOptions): Promise<unknown> };

export interface EndDeps {
  tickets: EndTickets;
  /** Absent when the logs module is off: cost stays 0 and nothing is annotated. */
  logs: EndLogs | undefined;
  git: GitPort;
  clock: () => Date;
}

export interface SessionEnd {
  /** Process exit code, when known. */
  exitCode?: number;
  /** The user closed the session (typed /exit, closed the tab) rather than it crashing. */
  closedByUser?: boolean;
  /** Claude conversation id, so ingest can be limited to its transcript. */
  claudeSessionId?: string;
}

export interface EndResult {
  outcome: Outcome;
  summary: "agent" | "mechanical";
  costUsd: number;
  /** Set when the run needs a human (no agent summary). */
  needsAttention?: "no agent summary";
}

/** Local `YYYY-MM-DD HH:mm` -> epoch ms. */
export function parseCommentTime(t: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(t);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime() : undefined;
}

/** A comment written during the run by the run's agent (`kt comment` with `KH_RUN` authors as `agent:<runId>`). */
export function findAgentSummary(ticket: Issue, run: Pick<RunInfo, "runId" | "startedAt">, endedAt: number): Comment | undefined {
  const from = Math.floor(run.startedAt / 60_000) * 60_000;
  return ticket.feed.find((f): f is Comment => {
    if (f.type !== "comment" || f.author === PLUGIN_AUTHOR) return false;
    if (f.author !== `agent:${run.runId}` && f.author !== run.runId) return false;
    const t = parseCommentTime(f.time);
    return t !== undefined && t >= from && t <= endedAt + 60_000;
  });
}

export interface OutcomeInput {
  hasSummary: boolean;
  criteria: { checked: number; total: number };
  commits: number;
  exitCode?: number;
  closedByUser?: boolean;
  durationMs: number;
}

export function computeOutcome(i: OutcomeInput): Outcome {
  if (i.hasSummary) return i.criteria.checked >= i.criteria.total ? "success" : "partial";
  if (i.closedByUser && i.commits === 0 && i.durationMs <= ABANDON_MS) return "abandoned";
  if ((i.exitCode !== undefined && i.exitCode !== 0) || i.commits === 0) return "failed";
  return "partial";
}

/** Sum of the ticket's run costs from the index (each run counted once). */
export function sumRunCost(entries: readonly Pick<RunIndexEntry, "runId" | "costUsd">[]): number {
  const seen = new Map<string, number>();
  for (const e of entries) seen.set(e.runId, e.costUsd);
  return Math.round([...seen.values()].reduce((a, b) => a + b, 0) * 1e6) / 1e6;
}

/** The status a finished run moves a started ticket to: "In Review" by name, else the last started-category status. */
export function reviewStatus(statuses: readonly StatusDef[]): StatusDef | undefined {
  const started = statuses.filter((s) => s.category === "started").sort((a, b) => a.order - b.order);
  return started.find((s) => /review/i.test(s.name)) ?? (started.length > 1 ? started[started.length - 1] : undefined);
}

async function gitSafe(git: GitPort, args: string[], cwd: string): Promise<string> {
  try {
    return await git.run(args, cwd);
  } catch {
    return "";
  }
}

async function baseOf(git: GitPort, run: RunInfo): Promise<string | undefined> {
  if (run.base) return run.base;
  const branch = await defaultBranch(git, run.worktree).catch(() => "");
  if (!branch) return undefined;
  return (await gitSafe(git, ["merge-base", branch, "HEAD"], run.worktree)).trim() || undefined;
}

/**
 * What happens when a launched run's session ends (ADR-0001: git and hook events only, no AI).
 * Pure over injected tickets / logs / git / clock; the caller guarantees it runs once per run.
 */
export async function finishRun(deps: EndDeps, run: RunInfo, end: SessionEnd = {}): Promise<EndResult | undefined> {
  const { tickets, logs, git } = deps;
  const endedAt = deps.clock().getTime();
  if (!tickets.get(run.ticketId)) return undefined;

  if (logs) {
    try {
      await logs.ingest(end.claudeSessionId ? { sessionId: end.claudeSessionId } : {});
    } catch (e) {
      console.error("kyle-hub: ingest at run end failed", e);
    }
  }
  const ticket = tickets.get(run.ticketId)!;
  const entries = logs ? await logs.runs({ ticketId: run.ticketId }).catch(() => []) : [];
  const own = entries.find((e) => e.runId === run.runId);
  const costUsd = sumRunCost(entries);
  const durationMs = Math.max(0, endedAt - run.startedAt);

  const base = await baseOf(git, run);
  const commits = base
    ? (await gitSafe(git, ["log", "--format=%s", `${base}..HEAD`], run.worktree)).split("\n").map((l) => l.trim()).filter(Boolean)
    : [];
  const criteria = parseAcceptance(ticket.description);
  const hasSummary = findAgentSummary(ticket, run, endedAt) !== undefined;
  const outcome = computeOutcome({ hasSummary, criteria, commits: commits.length, exitCode: end.exitCode, closedByUser: end.closedByUser, durationMs });
  const actor = { author: PLUGIN_AUTHOR };

  if (!hasSummary) {
    const diffStat = base ? (await gitSafe(git, ["diff", "--stat", `${base}...HEAD`], run.worktree)).trimEnd() : "";
    await tickets.comment(
      run.ticketId,
      mechanicalSummary({ runId: run.runId, durationMs: own?.durationMs ?? durationMs, costUsd: own?.costUsd ?? 0, diffStat, commits, criteria, exitCode: end.exitCode }),
      actor,
    );
  }

  const patch: { status?: string; outcome: Outcome; costUsd: number } = { outcome, costUsd };
  if (hasSummary && categoryOf(ticket.status, tickets.statuses()) === "started") {
    const review = reviewStatus(tickets.statuses());
    if (review && review.name !== ticket.status) patch.status = review.name;
  }
  await tickets.update(run.ticketId, patch, actor);
  if (hasSummary) await tickets.logEvent(run.ticketId, `run ${run.runId} finished`, actor);
  if (logs) await logs.annotateRun(run.runId, { outcome, summaryCommented: hasSummary }).catch(() => undefined);

  return { outcome, summary: hasSummary ? "agent" : "mechanical", costUsd, ...(hasSummary ? {} : { needsAttention: "no agent summary" as const }) };
}
