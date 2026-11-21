import { categoryOf } from "../../../core/domain/fields";
import type { Issue, StatusDef } from "../../../core/domain/types";
import type { RepoConfig } from "../../../core/domain/fields";
import { branchName, defaultBranch, safeSegment, type FsPort, type GitPort } from "../launch/launch";

export interface CleanupDeps {
  git: GitPort;
  fs: Pick<FsPort, "exists">;
  tickets: { get(id: string): Issue | undefined; statuses(): StatusDef[]; repoOf(id: string): string | undefined };
  repos: () => Record<string, RepoConfig>;
  /** True when the GitHub PR at `url` is merged (read-only `gh pr view`); false on any failure. */
  prMerged: (url: string) => Promise<boolean>;
  /** Shows "Remove worktree for <ID>?" and resolves true for Remove, false for Keep. */
  offer: (message: string) => Promise<boolean>;
  join: (...parts: string[]) => string;
  dirname: (p: string) => string;
}

export type CleanupResult =
  | { kind: "none"; why: "not-completed" | "no-worktree" | "not-merged" }
  | { kind: "kept" }
  | { kind: "removed"; branchDeleted: boolean }
  | { kind: "failed"; message: string };

/** Worktree path of a launched ticket (mirrors `Launcher.launch`). */
export function worktreePath(deps: Pick<CleanupDeps, "join" | "dirname">, repoKey: string, repo: RepoConfig, ticketId: string): string {
  return deps.join(deps.dirname(repo.path), ".kh-worktrees", safeSegment(repoKey), safeSegment(ticketId));
}

async function branchMerged(git: GitPort, repoPath: string, branch: string): Promise<boolean> {
  try {
    const into = await defaultBranch(git, repoPath);
    const out = await git.run(["branch", "--merged", into, "--list", branch], repoPath);
    return out.split("\n").some((l) => l.replace(/^[*+\s]+/, "").trim() === branch);
  } catch {
    return false;
  }
}

/**
 * When a ticket reaches a completed status and its work is merged, offer to remove its worktree.
 * Never automatic; never deletes a branch that is not merged (`git branch -d`, not `-D`).
 */
export async function offerWorktreeCleanup(d: CleanupDeps, ticketId: string): Promise<CleanupResult> {
  const ticket = d.tickets.get(ticketId);
  if (!ticket || categoryOf(ticket.status, d.tickets.statuses()) !== "completed") return { kind: "none", why: "not-completed" };
  const key = d.tickets.repoOf(ticketId);
  const repo = key ? d.repos()[key] : undefined;
  if (!key || !repo || repo.worktrees === false) return { kind: "none", why: "no-worktree" };
  const wt = worktreePath(d, key, repo, ticketId);
  if (!d.fs.exists(wt)) return { kind: "none", why: "no-worktree" };

  const branch = branchName(ticket);
  const prs = ticket.pullRequests ?? [];
  let merged = false;
  for (const url of prs) {
    if (await d.prMerged(url)) {
      merged = true;
      break;
    }
  }
  const branchIsMerged = await branchMerged(d.git, repo.path, branch);
  if (!merged && !branchIsMerged) return { kind: "none", why: "not-merged" };

  if (!(await d.offer(`Remove worktree for ${ticketId}?`))) return { kind: "kept" };
  try {
    await d.git.run(["worktree", "remove", wt], repo.path);
  } catch (e) {
    return { kind: "failed", message: `git worktree remove failed: ${(e as Error).message}` };
  }
  // A merged PR can squash-merge, so the branch may not look merged to git; `-d` then refuses and the branch stays.
  let branchDeleted = false;
  if (branchIsMerged) {
    try {
      await d.git.run(["branch", "-d", branch], repo.path);
      branchDeleted = true;
    } catch {
      /* keep the branch */
    }
  }
  return { kind: "removed", branchDeleted };
}
