import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { RepoConfig } from "../../../core/domain/fields";
import type { Issue, StatusDef } from "../../../core/domain/types";
import { branchName } from "../launch/launch";
import { realFs, realGit } from "../launch/git";
import { offerWorktreeCleanup, type CleanupDeps } from "../run/cleanup";

const STATUSES: StatusDef[] = [
  { name: "In Progress", category: "started", color: "", order: 1 },
  { name: "Done", category: "completed", color: "", order: 2 },
];
const ticket = (over: Partial<Issue> = {}): Issue => ({ id: "LOCK-9", title: "Widget", status: "Done", tags: [], pullRequests: [], feed: [], ...over }) as unknown as Issue;

function fakeDeps(o: { status?: string; exists?: boolean; merged?: boolean; pr?: boolean; accept?: boolean; prs?: string[] }) {
  const calls: string[][] = [];
  const deps: CleanupDeps = {
    git: {
      run: async (args) => {
        calls.push(args);
        if (args[0] === "symbolic-ref") throw new Error("none");
        if (args[0] === "rev-parse") return args.at(-1) === "refs/heads/main" ? "abc" : (() => { throw new Error("x"); })();
        if (args[0] === "branch" && args[1] === "--merged") return o.merged ? `  ${branchName(ticket())}\n` : "";
        return "";
      },
    },
    fs: { exists: () => o.exists ?? true },
    tickets: { get: () => ticket({ status: o.status ?? "Done", pullRequests: o.prs ?? [] }), statuses: () => STATUSES, repoOf: () => "k" },
    repos: () => ({ k: { path: "/code/k", profile: "home" } as RepoConfig }),
    prMerged: async () => o.pr ?? false,
    offer: vi.fn(async () => o.accept ?? true),
    join: path.posix.join,
    dirname: path.posix.dirname,
  };
  return { deps, calls };
}

describe("offerWorktreeCleanup (fake git)", () => {
  it("offers nothing unless the ticket is completed", async () => {
    const { deps } = fakeDeps({ status: "In Progress", merged: true });
    expect(await offerWorktreeCleanup(deps, "LOCK-9")).toEqual({ kind: "none", why: "not-completed" });
    expect(deps.offer).not.toHaveBeenCalled();
  });

  it("offers nothing when the worktree is gone or the work is not merged", async () => {
    expect((await offerWorktreeCleanup(fakeDeps({ exists: false, merged: true }).deps, "LOCK-9")).kind).toBe("none");
    const nm = fakeDeps({ merged: false });
    expect(await offerWorktreeCleanup(nm.deps, "LOCK-9")).toEqual({ kind: "none", why: "not-merged" });
    expect(nm.deps.offer).not.toHaveBeenCalled();
  });

  it("Keep leaves everything alone", async () => {
    const { deps, calls } = fakeDeps({ merged: true, accept: false });
    expect(await offerWorktreeCleanup(deps, "LOCK-9")).toEqual({ kind: "kept" });
    expect(calls.some((a) => a[0] === "worktree")).toBe(false);
  });

  it("Remove runs worktree remove and a safe branch delete when merged", async () => {
    const { deps, calls } = fakeDeps({ merged: true });
    expect(await offerWorktreeCleanup(deps, "LOCK-9")).toEqual({ kind: "removed", branchDeleted: true });
    expect(calls).toContainEqual(["worktree", "remove", "/code/.kh-worktrees/k/LOCK-9"]);
    expect(calls).toContainEqual(["branch", "-d", branchName(ticket())]);
  });

  it("a merged PR offers removal but never deletes a branch git does not see as merged", async () => {
    const { deps, calls } = fakeDeps({ merged: false, pr: true, prs: ["https://github.com/o/r/pull/1"] });
    expect(await offerWorktreeCleanup(deps, "LOCK-9")).toEqual({ kind: "removed", branchDeleted: false });
    expect(calls.some((a) => a[0] === "branch" && a[1] !== "--merged")).toBe(false);
  });
});

describe("offerWorktreeCleanup (real temp repo)", () => {
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });

  function repoWithWorktree(commitOnBranch: boolean, mergeIt: boolean) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kh-clean-"));
    const repo = path.join(root, "r");
    fs.mkdirSync(repo);
    git(repo, "init", "-b", "main");
    fs.writeFileSync(path.join(repo, "a.txt"), "a");
    git(repo, "add", "."), git(repo, "commit", "-m", "init");
    const branch = branchName(ticket());
    const wt = path.join(root, ".kh-worktrees", "k", "LOCK-9");
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    git(repo, "worktree", "add", "-b", branch, wt, "main");
    if (commitOnBranch) {
      fs.writeFileSync(path.join(wt, "b.txt"), "b");
      git(wt, "add", "."), git(wt, "commit", "-m", "work");
    }
    if (mergeIt) git(repo, "merge", "--no-ff", "-m", "merge", branch);
    const deps: CleanupDeps = {
      git: realGit,
      fs: realFs,
      tickets: { get: () => ticket(), statuses: () => STATUSES, repoOf: () => "k" },
      repos: () => ({ k: { path: repo, profile: "home" } as RepoConfig }),
      prMerged: async () => false,
      offer: async () => true,
      join: path.join,
      dirname: path.dirname,
    };
    return { root, repo, wt, branch, deps };
  }

  it("merged branch: worktree removed and branch deleted", async () => {
    const t = repoWithWorktree(true, true);
    try {
      expect(await offerWorktreeCleanup(t.deps, "LOCK-9")).toEqual({ kind: "removed", branchDeleted: true });
      expect(fs.existsSync(t.wt)).toBe(false);
      expect(git(t.repo, "branch", "--list", t.branch).trim()).toBe("");
    } finally {
      fs.rmSync(t.root, { recursive: true, force: true });
    }
  });

  it("unmerged branch with commits: no offer, worktree and branch survive", async () => {
    const t = repoWithWorktree(true, false);
    try {
      const offer = vi.fn(async () => true);
      expect(await offerWorktreeCleanup({ ...t.deps, offer }, "LOCK-9")).toEqual({ kind: "none", why: "not-merged" });
      expect(offer).not.toHaveBeenCalled();
      expect(fs.existsSync(t.wt)).toBe(true);
      expect(git(t.repo, "branch", "--list", t.branch)).toContain(t.branch);
    } finally {
      git(t.repo, "worktree", "remove", "--force", t.wt);
      fs.rmSync(t.root, { recursive: true, force: true });
    }
  });
});
