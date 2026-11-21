import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Issue, StatusDef } from "../../../core/domain/types";
import type { TicketService } from "../../../core/services";
import { applyDiff, applyProposal, canApply } from "../retro/apply";
import { readRetroState } from "../retro/state";
import { renderTemplate, type TemplateContext } from "../retro/templates";
import { withDiff } from "../retro/ticketMeta";
import type { Cluster } from "../retro/types";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "kh-apply-test-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const git = (cwd: string, ...a: string[]): string => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, encoding: "utf8" });

const ctxFor = (claudeHome: string, repo?: string): TemplateContext => ({
  claudeHome,
  repoPath: (k) => (k === "r" ? repo : undefined),
  readFile: (p) => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return undefined;
    }
  },
});

const cluster = (signature: string, kind: Cluster["kind"], repo?: string): Cluster => ({
  kind,
  signature,
  count: 3,
  sessions: ["a", "b"],
  runIds: ["r-1"],
  firstSeen: "2026-11-01T00:00:00Z",
  lastSeen: "2026-11-02T00:00:00Z",
  ...(repo ? { repo } : {}),
});

describe("applyDiff", () => {
  it("git repo: applies after --check, creating and changing files", async () => {
    const repo = path.join(root, "repo");
    fs.mkdirSync(repo);
    git(repo, "init", "-b", "main");
    fs.writeFileSync(path.join(repo, "CLAUDE.md"), "# Rules\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "init");
    const t = renderTemplate(cluster("seq:git add <path>|git commit -m <num>|git push", "command_sequence", "r"), ctxFor(path.join(root, "home"), repo));
    const r = await applyDiff(repo, t.diff!);
    expect(r).toMatchObject({ ok: true, git: true, backups: [] });
    expect(fs.readFileSync(path.join(repo, "CLAUDE.md"), "utf8")).toMatch(/# Rules\r?\nUse `scripts\/git-git-git-[0-9a-f]{4}\.ps1`/);
    expect(fs.readdirSync(path.join(repo, "scripts"))).toHaveLength(1);
  });

  it("git repo: a failing --check leaves every file untouched", async () => {
    const repo = path.join(root, "repo");
    fs.mkdirSync(repo);
    git(repo, "init", "-b", "main");
    fs.writeFileSync(path.join(repo, "CLAUDE.md"), "# Rules\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "init");
    const t = renderTemplate(cluster("seq:git add <path>|git commit -m <num>|git push", "command_sequence", "r"), ctxFor(path.join(root, "home"), repo));
    fs.writeFileSync(path.join(repo, "CLAUDE.md"), "# Changed since the proposal\n");
    const r = await applyDiff(repo, t.diff!);
    expect(r.ok).toBe(false);
    expect(fs.readFileSync(path.join(repo, "CLAUDE.md"), "utf8")).toBe("# Changed since the proposal\n");
    expect(fs.existsSync(path.join(repo, "scripts"))).toBe(false);
  });

  it("non-git target: timestamped backup, then the built-in patcher", async () => {
    const home = path.join(root, "claude");
    fs.mkdirSync(home);
    const settings = path.join(home, "settings.json");
    fs.writeFileSync(settings, '{\n  "permissions": {\n    "allow": [\n      "Read"\n    ]\n  }\n}\n');
    const t = renderTemplate(cluster("perm:Bash:rm <path>", "permission_denied"), ctxFor(home));
    const r = await applyDiff(home, t.diff!, new Date("2026-11-21T10:20:30Z"));
    expect(r.ok && r.git).toBe(false);
    expect(JSON.parse(fs.readFileSync(settings, "utf8")).permissions.allow).toEqual(["Read", "Bash(rm *)"]);
    const bak = fs.readdirSync(home).filter((f) => f.endsWith(".bak"));
    expect(bak).toEqual(["settings.json.20261121-102030.bak"]);
    expect(fs.readFileSync(path.join(home, bak[0]!), "utf8")).toContain('"Read"\n');
    expect(fs.readFileSync(path.join(home, bak[0]!), "utf8")).not.toContain("Bash(rm");
  });

  it("non-git target: a stale diff changes nothing and makes no backup", async () => {
    const home = path.join(root, "claude");
    fs.mkdirSync(home);
    const settings = path.join(home, "settings.json");
    fs.writeFileSync(settings, '{\n  "permissions": {\n    "allow": [\n      "Read"\n    ]\n  }\n}\n');
    const t = renderTemplate(cluster("perm:Bash:rm <path>", "permission_denied"), ctxFor(home));
    fs.writeFileSync(settings, '{ "other": true }\n');
    const r = await applyDiff(home, t.diff!);
    expect(r.ok).toBe(false);
    expect(fs.readFileSync(settings, "utf8")).toBe('{ "other": true }\n');
    expect(fs.readdirSync(home)).toEqual(["settings.json"]);
  });
});

const STATUSES = [
  { name: "Triage", category: "triage" },
  { name: "Todo", category: "unstarted" },
  { name: "Done", category: "completed" },
] as unknown as StatusDef[];

function fakeTickets(issue: Issue) {
  const comments: string[] = [];
  const svc = {
    get: (id: string) => (id === issue.id ? issue : undefined),
    statuses: () => STATUSES,
    userName: () => "me",
    comment: async (_id: string, body: string) => {
      comments.push(body);
      return issue;
    },
    update: async (_id: string, patch: { tags?: string[] }) => {
      if (patch.tags) issue.tags = patch.tags;
      return issue;
    },
  } as unknown as TicketService;
  return { svc, comments };
}

describe("applyProposal", () => {
  const make = (home: string, status: string): Issue => {
    const t = renderTemplate(cluster("perm:Bash:rm <path>", "permission_denied"), ctxFor(home));
    return { id: "TIX-9", type: "proposal", status, tags: [], description: withDiff(t.body, t.diff) } as unknown as Issue;
  };

  it("only accepted, open proposals with a diff", () => {
    const home = path.join(root, "claude");
    fs.mkdirSync(home);
    expect(canApply(make(home, "Triage"), STATUSES)).toBe(false);
    expect(canApply(make(home, "Done"), STATUSES)).toBe(false);
    expect(canApply(make(home, "Todo"), STATUSES)).toBe(true);
    expect(canApply({ ...make(home, "Todo"), tags: ["applied"] }, STATUSES)).toBe(false);
    expect(canApply({ ...make(home, "Todo"), type: "finding" } as Issue, STATUSES)).toBe(false);
  });

  it("success: comment, applied label, retro.json record", async () => {
    const home = path.join(root, "claude");
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, "settings.json"), '{\n  "permissions": {\n    "allow": []\n  }\n}\n');
    const issue = make(home, "Todo");
    const { svc, comments } = fakeTickets(issue);
    const stateFile = path.join(root, "retro.json");
    const at = new Date("2026-11-21T12:00:00Z");
    const r = await applyProposal({ tickets: svc, stateFile, now: () => at }, "TIX-9");
    expect(r.ok).toBe(true);
    expect(comments[0]).toMatch(/^Applied at 2026-11-21T12:00:00.000Z/);
    expect(comments[0]).toContain("settings.json");
    expect(issue.tags).toEqual(["applied"]);
    expect(readRetroState(stateFile).applied).toEqual([{ signature: "perm:Bash:rm <path>", appliedAt: at.toISOString(), ticketId: "TIX-9", quietRetros: 0 }]);
  });

  it("failure: comments the error and changes nothing", async () => {
    const home = path.join(root, "claude");
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, "settings.json"), '{\n  "permissions": {\n    "allow": []\n  }\n}\n');
    const issue = make(home, "Todo");
    fs.writeFileSync(path.join(home, "settings.json"), "{}\n");
    const { svc, comments } = fakeTickets(issue);
    const stateFile = path.join(root, "retro.json");
    const r = await applyProposal({ tickets: svc, stateFile }, "TIX-9");
    expect(r.ok).toBe(false);
    expect(comments[0]).toMatch(/^Apply failed, nothing was changed/);
    expect(issue.tags).toEqual([]);
    expect(fs.existsSync(stateFile)).toBe(false);
    expect(fs.readFileSync(path.join(home, "settings.json"), "utf8")).toBe("{}\n");
  });
});
