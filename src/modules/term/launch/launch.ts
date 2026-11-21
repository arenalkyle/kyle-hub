import type { SessionInfo, SpawnSessionOptions, TicketService } from "../../../core";
import { buildPack } from "../../../core/domain/pack";
import type { Issue } from "../../../core/domain/types";
import type { Model, RepoConfig } from "../../../core/domain/fields";

export interface GitPort {
  /** Runs `git <args>` in `cwd`; rejects on a non-zero exit. */
  run(args: string[], cwd: string): Promise<string>;
}

export interface FsPort {
  exists(p: string): boolean;
  mkdirp(p: string): void;
  writeFile(p: string, text: string): void;
}

export interface LaunchSettings {
  maxConcurrentRuns: number;
  defaultModel: Model;
  /** Command typed for a Claude session (`claude`). */
  claudeCommand: string;
}

export interface LaunchDeps {
  git: GitPort;
  fs: FsPort;
  sessions: {
    spawn(opts: SpawnSessionOptions): SessionInfo;
    get(id: string): SessionInfo | undefined;
    list(): SessionInfo[];
  };
  tickets: Pick<TicketService, "get" | "repoOf" | "statuses" | "update" | "logEvent" | "userName">;
  clock: () => Date;
  repos: () => Record<string, RepoConfig>;
  settings: () => LaunchSettings;
  /** `<localappdata>\kyle-hub\<profile>\packs`. */
  packDir: (profile: RepoConfig["profile"]) => string;
  /** Called when the ticket has no (known) repo; resolve to a repo-map key or undefined to cancel. */
  pickRepo: (keys: string[]) => Promise<string | undefined>;
  join: (...parts: string[]) => string;
  dirname: (p: string) => string;
}

export type LaunchFailure =
  | "unknown-ticket"
  | "no-repo"
  | "cancelled"
  | "concurrency"
  | "no-started-status"
  | "unsafe-path"
  | "git"
  | "spawn";

export type LaunchResult =
  | { ok: true; runId: string; sessionId: string; cwd: string; branch?: string; reusedWorktree: boolean; alreadyRunning?: undefined }
  | { ok: true; alreadyRunning: true; sessionId: string }
  | { ok: false; reason: LaunchFailure; message: string };

const p2 = (n: number): string => String(n).padStart(2, "0");

/** `r-<YYYYMMDD-HHmmss>-<ID>` */
export function makeRunId(now: Date, ticketId: string): string {
  return `r-${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}-${ticketId}`;
}

/** Lowercase ASCII slug for a branch name; never empty, never ends in `-`. */
export function branchSlug(title: string, max = 40): string {
  const s = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, max).replace(/-+$/, "");
  return s || "work";
}

/** Path segment safe for a directory name. */
export const safeSegment = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+/, "") || "x";

export const branchName = (ticket: Pick<Issue, "id" | "title">): string => `kh/${safeSegment(ticket.id)}-${branchSlug(ticket.title)}`;

const WORKTREE_CWD = /[\\/]\.kh-worktrees[\\/][^\\/]+[\\/]([^\\/]+)[\\/]?$/;

const fail = (reason: LaunchFailure, message: string): LaunchResult => ({ ok: false, reason, message });

/** Orchestrates one launch with every side effect injected. */
export class Launcher {
  /** ticket id -> session id of runs started in this Obsidian session. */
  private readonly started = new Map<string, string>();

  constructor(private readonly deps: LaunchDeps) {}

  /** Live runs: started here, plus open sessions whose cwd is a kh worktree (rebuilds the map after a restore). */
  runningTickets(): Map<string, string> {
    const out = new Map<string, string>();
    for (const [id, sid] of [...this.started]) {
      const s = this.deps.sessions.get(sid);
      if (s && s.state !== "exited") out.set(id, sid);
      else this.started.delete(id);
    }
    for (const s of this.deps.sessions.list()) {
      if (s.state === "exited") continue;
      const m = WORKTREE_CWD.exec(s.cwd);
      if (m && !out.has(m[1]!)) out.set(m[1]!, s.id);
    }
    return out;
  }

  async launch(id: string): Promise<LaunchResult> {
    const d = this.deps;
    const ticket = d.tickets.get(id);
    if (!ticket) return fail("unknown-ticket", `Ticket ${id} not found.`);
    const running = this.runningTickets();
    const live = running.get(id);
    if (live) return { ok: true, alreadyRunning: true, sessionId: live };
    const cfg = d.settings();
    if (running.size >= cfg.maxConcurrentRuns) {
      return fail("concurrency", `${running.size} runs are active (limit ${cfg.maxConcurrentRuns}). Finish one first.`);
    }

    const repos = d.repos();
    let key = d.tickets.repoOf(id);
    if (!key || !repos[key]) {
      const keys = Object.keys(repos).sort();
      if (keys.length === 0) return fail("no-repo", "No repos in the repo map; add one in settings.");
      key = await d.pickRepo(keys);
      if (!key || !repos[key]) return fail("cancelled", "No repo chosen.");
    }
    const repo = repos[key]!;
    const started = [...d.tickets.statuses()].filter((s) => s.category === "started").sort((a, b) => a.order - b.order)[0];
    if (!started) return fail("no-started-status", "No started-category status exists.");

    const runId = makeRunId(d.clock(), id);
    const packPath = d.join(d.packDir(repo.profile), `${runId}.md`);
    if (/\s/.test(packPath)) return fail("unsafe-path", `Pack path contains whitespace: ${packPath}`);

    let cwd = repo.path;
    let branch: string | undefined;
    let reused = false;
    if (repo.worktrees !== false) {
      branch = branchName(ticket);
      cwd = d.join(d.dirname(repo.path), ".kh-worktrees", safeSegment(key), safeSegment(id));
      if (/\s/.test(cwd)) return fail("unsafe-path", `Worktree path contains whitespace: ${cwd}. Move the repo to a path without spaces.`);
      reused = d.fs.exists(cwd);
      if (!reused) {
        try {
          await this.addWorktree(repo.path, cwd, branch);
        } catch (e) {
          return fail("git", `git worktree add failed: ${(e as Error).message}`);
        }
      }
    }

    const parentId = ticket.parent?.replace(/^\[\[|\]\]$/g, "");
    const parent = parentId ? d.tickets.get(parentId) : undefined;
    const blockers = (ticket.blockedBy ?? []).flatMap((b) => {
      const t = d.tickets.get(b);
      if (!t) return [];
      const last = [...t.feed].reverse().find((f) => f.type === "comment");
      return [{ id: t.id, title: t.title, lastComment: last?.type === "comment" ? last.body : undefined }];
    });
    const pack = buildPack({
      runId,
      ticket: { id, title: ticket.title, description: ticket.description },
      repo: key,
      branch,
      parent: parent ? { id: parent.id, title: parent.title, description: parent.description } : undefined,
      blockers,
      previousRun: ticket.runs?.[ticket.runs.length - 1],
    });
    const model = ticket.model ?? cfg.defaultModel;
    let session: SessionInfo;
    try {
      d.fs.mkdirp(d.dirname(packPath));
      d.fs.writeFile(packPath, pack);
      session = d.sessions.spawn({
        cwd,
        command: cfg.claudeCommand || "claude",
        args: ["--model", model, `Work ticket ${id}. Context: @${packPath}`],
        env: { KH_TICKET: id, KH_RUN: runId, KH_AGENT: "1" },
        title: id,
      });
    } catch (e) {
      return fail("spawn", `Could not start the session: ${(e as Error).message}`);
    }
    this.started.set(id, session.id);

    const user = d.tickets.userName();
    await d.tickets.update(id, { status: started.name, runs: [...(ticket.runs ?? []), runId] }, { author: user });
    await d.tickets.logEvent(id, `launched by @${user} (model ${model}, run ${runId})`, { author: user });
    return { ok: true, runId, sessionId: session.id, cwd, branch, reusedWorktree: reused };
  }

  /** `git worktree add` from the repo's default branch; reuses the branch when it already exists. */
  private async addWorktree(repoPath: string, wt: string, branch: string): Promise<void> {
    const { git, fs, dirname } = this.deps;
    fs.mkdirp(dirname(wt));
    if (await hasRef(git, repoPath, `refs/heads/${branch}`)) {
      await git.run(["worktree", "add", wt, branch], repoPath);
      return;
    }
    await git.run(["worktree", "add", "-b", branch, wt, await defaultBranch(git, repoPath)], repoPath);
  }
}

async function hasRef(git: GitPort, cwd: string, ref: string): Promise<boolean> {
  try {
    await git.run(["rev-parse", "--verify", "--quiet", ref], cwd);
    return true;
  } catch {
    return false;
  }
}

/** origin/HEAD target, else `main`, else `master`, else the checked-out branch. */
export async function defaultBranch(git: GitPort, cwd: string): Promise<string> {
  try {
    const out = (await git.run(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd)).trim();
    if (out) return out;
  } catch {
    /* no remote HEAD */
  }
  for (const b of ["main", "master"]) if (await hasRef(git, cwd, `refs/heads/${b}`)) return b;
  return (await git.run(["rev-parse", "--abbrev-ref", "HEAD"], cwd)).trim() || "HEAD";
}
