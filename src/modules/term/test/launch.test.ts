import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SessionInfo, SpawnSessionOptions } from "../../../core";
import type { RepoConfig } from "../../../core/domain/fields";
import type { Issue } from "../../../core/domain/types";
import { branchName, branchSlug, defaultBranch, Launcher, makeRunId, type GitPort, type LaunchDeps } from "../launch/launch";
import type { AccountsSettings } from "../../../core/accounts";
import { realFs, realGit } from "../launch/git";

const STATUSES = [
  { name: "Todo", category: "unstarted", color: "", order: 1 },
  { name: "In Review", category: "started", color: "", order: 3 },
  { name: "In Progress", category: "started", color: "", order: 2 },
];

const ticket = (over: Partial<Issue> = {}): Issue =>
  ({ id: "LOCK-9", title: "Add the Widget!", status: "Todo", tags: ["agent-ready"], description: "Do it.\n\n## Acceptance criteria\n\n- [ ] works", feed: [], runs: [], ...over }) as unknown as Issue;

interface Opts {
  ticket?: Issue;
  repos?: Record<string, RepoConfig>;
  repoOf?: string | undefined;
  existing?: Set<string>;
  max?: number;
  pick?: string | undefined;
  gitFail?: boolean;
  vault?: "home" | "work";
  accounts?: AccountsSettings;
  pickAccount?: LaunchDeps["pickAccount"];
}

function setup(opts: Opts = {}) {
  const t = opts.ticket ?? ticket();
  const files = new Map<string, string>();
  const exists = opts.existing ?? new Set<string>();
  const gitCalls: string[][] = [];
  const git: GitPort = {
    run: async (args) => {
      gitCalls.push(args);
      if (opts.gitFail && args[0] === "worktree") throw new Error("boom");
      if (args[0] === "symbolic-ref") throw new Error("no origin");
      if (args[0] === "rev-parse" && args.includes("--verify")) {
        if (args.at(-1) === "refs/heads/main") return "abc";
        throw new Error("missing");
      }
      return "";
    },
  };
  const sessions: SessionInfo[] = [];
  const spawn = vi.fn((o: SpawnSessionOptions): SessionInfo => {
    const s: SessionInfo = { id: `s${sessions.length + 1}`, kind: "claude", title: o.title ?? "", cwd: o.cwd ?? "", state: "working" };
    sessions.push(s);
    return s;
  });
  const update = vi.fn(async () => t);
  const logEvent = vi.fn(async () => t);
  const pickRepo = vi.fn(async () => opts.pick);
  const deps: LaunchDeps = {
    git,
    fs: { exists: (p) => exists.has(p), mkdirp: (p) => void exists.add(p), writeFile: (p, x) => void files.set(p, x) },
    sessions: { spawn, get: (id) => sessions.find((s) => s.id === id), list: () => sessions },
    tickets: {
      get: (id) => (id === t.id ? t : undefined),
      repoOf: () => ("repoOf" in opts ? opts.repoOf : "hub"),
      statuses: () => STATUSES as never,
      update,
      logEvent,
      userName: () => "kyle",
      projectDescription: () => undefined,
    },
    clock: () => new Date(2026, 10, 21, 10, 15, 30),
    vaultProfile: () => opts.vault ?? "home",
    repos: () => opts.repos ?? { hub: { path: "C:\\dev\\hub", profile: "home", worktrees: true } },
    settings: () => ({ maxConcurrentRuns: opts.max ?? 3, defaultModel: "sonnet", claudeCommand: "claude" }),
    packDir: () => "C:\\data\\home\\packs",
    pickRepo,
    accounts: () => opts.accounts ?? { list: [] },
    pickAccount: opts.pickAccount,
    join: path.win32.join,
    dirname: path.win32.dirname,
  };
  return { launcher: new Launcher(deps), spawn, update, logEvent, pickRepo, files, gitCalls, sessions, exists };
}

describe("launch guard (ADR-0008)", () => {
  it("refuses a repo whose profile differs from the vault's, naming both, before any git or spawn", async () => {
    const h = setup({ vault: "work" });
    const r = await h.launcher.launch("LOCK-9");
    expect(r).toMatchObject({ ok: false, reason: "profile-mismatch" });
    expect(!r.ok && r.message).toMatch(/home.*work|work.*home/);
    expect(h.gitCalls).toHaveLength(0);
    expect(h.spawn).not.toHaveBeenCalled();
    expect(h.files.size).toBe(0);
  });

  it("launches when the profiles match", async () => {
    const h = setup({ vault: "home" });
    expect(await h.launcher.launch("LOCK-9")).toMatchObject({ ok: true });
  });
});

const ACC = (id: string, over: Record<string, unknown> = {}) => ({ id, label: id, kind: "subscription" as const, plan: "max", configDir: `C:/cfg/${id}`, ...over });
const repoWith = (account?: string): Record<string, RepoConfig> => ({ hub: { path: "C:\dev\hub", profile: "home", worktrees: true, ...(account ? { account } : {}) } });

describe("account routing (ADR-0012)", () => {
  it("spawns with CLAUDE_CONFIG_DIR of the default account and carries the id on the run", async () => {
    const onRun = vi.fn();
    const h = setup({ accounts: { list: [ACC("main"), ACC("alt")], default: "main" } });
    (h.launcher as unknown as { deps: LaunchDeps }).deps.onRun = onRun;
    const r = await h.launcher.launch("LOCK-9");
    expect(r.ok).toBe(true);
    const env = h.spawn.mock.calls[0]![0].env!;
    expect(env.CLAUDE_CONFIG_DIR).toBe("C:/cfg/main");
    expect(env.KH_ACCOUNT).toBe("main");
    expect(onRun.mock.calls[0]![0].accountId).toBe("main");
  });

  it("repo account beats the default; ticket override beats the repo", async () => {
    const accounts = { list: [ACC("main"), ACC("alt"), ACC("third")], default: "main" };
    const a = setup({ accounts, repos: repoWith("alt") });
    await a.launcher.launch("LOCK-9");
    expect(a.spawn.mock.calls[0]![0].env!.CLAUDE_CONFIG_DIR).toBe("C:/cfg/alt");
    const b = setup({ accounts, repos: repoWith("alt"), ticket: ticket({ account: "third" } as never) });
    await b.launcher.launch("LOCK-9");
    expect(b.spawn.mock.calls[0]![0].env!.CLAUDE_CONFIG_DIR).toBe("C:/cfg/third");
  });

  it("no accounts configured: no CLAUDE_CONFIG_DIR is set", async () => {
    const h = setup();
    await h.launcher.launch("LOCK-9");
    expect(h.spawn.mock.calls[0]![0].env).not.toHaveProperty("CLAUDE_CONFIG_DIR");
  });

  it("picker choice is used and saved as the ticket override when it differs", async () => {
    const pick = vi.fn(async () => "alt");
    const h = setup({ accounts: { list: [ACC("main"), ACC("alt")], default: "main" }, pickAccount: pick });
    await h.launcher.launch("LOCK-9");
    expect(pick).toHaveBeenCalledWith(expect.any(Array), "main");
    expect(h.spawn.mock.calls[0]![0].env!.CLAUDE_CONFIG_DIR).toBe("C:/cfg/alt");
    expect((h.update.mock.calls[0] as unknown[])[1]).toMatchObject({ account: "alt" });
  });

  it("dismissed picker cancels before any git or spawn", async () => {
    const h = setup({ accounts: { list: [ACC("main"), ACC("alt")], default: "main" }, pickAccount: async () => undefined });
    expect(await h.launcher.launch("LOCK-9")).toMatchObject({ ok: false, reason: "cancelled" });
    expect(h.gitCalls).toHaveLength(0);
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("refuses an account whose profile mismatches the vault, before git or spawn", async () => {
    const h = setup({ vault: "home", accounts: { list: [ACC("corp", { profile: "work" })], default: "corp" } });
    const r = await h.launcher.launch("LOCK-9");
    expect(r).toMatchObject({ ok: false, reason: "account-profile-mismatch" });
    expect(!r.ok && r.message).toMatch(/work.*home/);
    expect(h.gitCalls).toHaveLength(0);
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("refuses a repo naming an unknown account", async () => {
    const h = setup({ accounts: { list: [ACC("main")], default: "main" }, repos: repoWith("gone") });
    expect(await h.launcher.launch("LOCK-9")).toMatchObject({ ok: false, reason: "unknown-account" });
    expect(h.spawn).not.toHaveBeenCalled();
  });
});

describe("helpers", () => {
  it("run id and slugs", () => {
    expect(makeRunId(new Date(2026, 0, 2, 3, 4, 5), "LOCK-9")).toBe("r-20260102-030405-LOCK-9");
    expect(branchSlug("Fix: the  BUG / ../ ünï")).toBe("fix-the-bug-n");
    expect(branchSlug("!!!")).toBe("work");
    expect(branchName({ id: "LOCK-9", title: "Add the Widget!" })).toBe("kh/LOCK-9-add-the-widget");
    expect(branchSlug("a".repeat(100)).length).toBe(40);
  });

  it("default branch falls back to main", async () => {
    const g: GitPort = {
      run: async (a) => {
        if (a[0] === "symbolic-ref") throw new Error("x");
        if (a.at(-1) === "refs/heads/main") return "";
        throw new Error("y");
      },
    };
    expect(await defaultBranch(g, "r")).toBe("main");
  });
});

describe("Launcher", () => {
  it("happy path: worktree, pack, spawn, ticket update", async () => {
    const s = setup();
    const r = await s.launcher.launch("LOCK-9");
    if (!r.ok || r.alreadyRunning) throw new Error("launch failed");
    expect(r).toMatchObject({ runId: "r-20261121-101530-LOCK-9", cwd: "C:\\dev\\.kh-worktrees\\hub\\LOCK-9", branch: "kh/LOCK-9-add-the-widget", reusedWorktree: false });
    expect(/\s/.test(r.cwd)).toBe(false);
    expect(s.gitCalls).toContainEqual(["worktree", "add", "-b", "kh/LOCK-9-add-the-widget", "C:\\dev\\.kh-worktrees\\hub\\LOCK-9", "main"]);
    const packPath = "C:\\data\\home\\packs\\r-20261121-101530-LOCK-9.md";
    expect(s.files.get(packPath)).toContain("kt comment LOCK-9");
    expect(s.spawn).toHaveBeenCalledWith({
      cwd: r.cwd,
      command: "claude",
      args: ["--model", "sonnet", `Work ticket LOCK-9. Context: @${packPath}`],
      env: { KH_TICKET: "LOCK-9", KH_RUN: r.runId, KH_AGENT: "1" },
      title: "LOCK-9",
    });
    expect(s.update).toHaveBeenCalledWith("LOCK-9", { status: "In Progress", runs: [r.runId] }, { author: "kyle" });
    expect(s.logEvent).toHaveBeenCalledWith("LOCK-9", `launched by @kyle (model sonnet, run ${r.runId})`, { author: "kyle" });
  });

  it("uses the ticket model; relaunch reuses the worktree and mentions the previous run", async () => {
    const s = setup({ ticket: ticket({ model: "opus", runs: ["r-old"] }), existing: new Set(["C:\\dev\\.kh-worktrees\\hub\\LOCK-9"]) });
    const r = await s.launcher.launch("LOCK-9");
    expect(r).toMatchObject({ ok: true, reusedWorktree: true });
    expect(s.gitCalls.some((c) => c[0] === "worktree")).toBe(false);
    expect([...s.files.values()][0]).toContain("Previous run of this ticket: r-old");
    expect(s.spawn.mock.calls[0]![0].args![1]).toBe("opus");
    const patch = s.update.mock.calls[0] as unknown as [string, { runs: string[] }];
    expect(patch[1].runs[0]).toBe("r-old");
    expect(patch[1].runs).toHaveLength(2);
  });

  it("worktrees: false runs in the repo path with no git", async () => {
    const s = setup({ repos: { hub: { path: "C:\\dev\\hub", profile: "home", worktrees: false } } });
    const r = await s.launcher.launch("LOCK-9");
    expect(r).toMatchObject({ ok: true, cwd: "C:\\dev\\hub", branch: undefined });
    expect(s.gitCalls).toEqual([]);
  });

  it("missing repo uses the picker callback; cancel and empty map refuse", async () => {
    const picked = setup({ repoOf: undefined, pick: "hub" });
    expect(await picked.launcher.launch("LOCK-9")).toMatchObject({ ok: true });
    expect(picked.pickRepo).toHaveBeenCalledWith(["hub"]);
    const cancelled = setup({ repoOf: "gone", pick: undefined });
    expect(await cancelled.launcher.launch("LOCK-9")).toMatchObject({ ok: false, reason: "cancelled" });
    expect(cancelled.spawn).not.toHaveBeenCalled();
    const empty = setup({ repoOf: undefined, repos: {} });
    expect(await empty.launcher.launch("LOCK-9")).toMatchObject({ ok: false, reason: "no-repo" });
  });

  it("refuses at the concurrency cap and leaves the ticket alone", async () => {
    const s = setup({ max: 1 });
    s.sessions.push({ id: "x", kind: "claude", title: "", cwd: "C:\\dev\\.kh-worktrees\\hub\\LOCK-1", state: "working" });
    const r = await s.launcher.launch("LOCK-9");
    expect(r).toMatchObject({ ok: false, reason: "concurrency" });
    expect(s.spawn).not.toHaveBeenCalled();
    expect(s.update).not.toHaveBeenCalled();
  });

  it("a ticket that is already running is focused, not relaunched", async () => {
    const s = setup();
    await s.launcher.launch("LOCK-9");
    expect(await s.launcher.launch("LOCK-9")).toMatchObject({ ok: true, alreadyRunning: true, sessionId: "s1" });
    expect(s.spawn).toHaveBeenCalledTimes(1);
    expect([...s.launcher.runningTickets().keys()]).toEqual(["LOCK-9"]);
  });

  it("rejects paths with spaces", async () => {
    const s = setup({ repos: { hub: { path: "C:\\my dev\\hub", profile: "home", worktrees: true } } });
    expect(await s.launcher.launch("LOCK-9")).toMatchObject({ ok: false, reason: "unsafe-path" });
    expect(s.gitCalls).toEqual([]);
  });

  it("reports a git failure without touching the ticket", async () => {
    const s = setup({ gitFail: true });
    expect(await s.launcher.launch("LOCK-9")).toMatchObject({ ok: false, reason: "git" });
    expect(s.update).not.toHaveBeenCalled();
  });
});

const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasGit)("Launcher with real git in a temp repo", () => {
  it("creates the worktree on the kh branch and reuses it on relaunch", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kh-launch-"));
    const repo = path.join(root, "repo");
    fs.mkdirSync(repo);
    const g = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: repo, stdio: "ignore" });
    g("init", "-b", "main");
    fs.writeFileSync(path.join(repo, "a.txt"), "a");
    g("add", ".");
    g("commit", "-m", "init");
    const t = ticket();
    const deps: LaunchDeps = {
      git: realGit,
      fs: realFs,
      sessions: {
        spawn: (o) => ({ id: "s1", kind: "claude", title: "", cwd: o.cwd ?? "", state: "working" }),
        get: () => undefined,
        list: () => [],
      },
      tickets: { get: () => t, repoOf: () => "r", statuses: () => STATUSES as never, update: async () => t, logEvent: async () => t, userName: () => "kyle", projectDescription: () => undefined },
      clock: () => new Date(),
      vaultProfile: () => "home",
      repos: () => ({ r: { path: repo, profile: "home", worktrees: true } }),
      settings: () => ({ maxConcurrentRuns: 3, defaultModel: "sonnet", claudeCommand: "claude" }),
      packDir: () => path.join(root, "packs"),
      pickRepo: async () => undefined,
      join: path.join,
      dirname: path.dirname,
    };
    try {
      const r = await new Launcher(deps).launch("LOCK-9");
      expect(r.ok && !r.alreadyRunning).toBe(true);
      const wt = path.join(root, ".kh-worktrees", "r", "LOCK-9");
      expect(fs.existsSync(path.join(wt, "a.txt"))).toBe(true);
      expect(execFileSync("git", ["branch", "--show-current"], { cwd: wt }).toString().trim()).toBe("kh/LOCK-9-add-the-widget");
      expect(await new Launcher(deps).launch("LOCK-9")).toMatchObject({ ok: true, reusedWorktree: true });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
