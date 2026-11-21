import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accountEnv,
  accountsOf,
  addAccount,
  checkAccountProfile,
  defaultConfigDir,
  removeAccount,
  renameAccount,
  resolveAccount,
  setDefaultAccount,
  type AccountsSettings,
} from "./accounts";
import { FileLogService } from "./logs/service";
import type { Profile } from "./logs/types";
import { runAccount, type AccountDeps } from "../../cli/commands/account/cli";
import type { Io } from "../../cli/commands/tickets/cli";

const FIXTURE = path.resolve(__dirname, "../../test/fixtures/transcripts/session-basic.jsonl");
const SECRET = "sk-ant-oat01-SENTINEL-DO-NOT-READ";

describe("registry", () => {
  it("adds, defaults the first, slugs ids and rejects duplicate dirs", () => {
    const s: AccountsSettings = { list: [] };
    const a = addAccount(s, { label: "Work Max", kind: "subscription", plan: "max", configDir: "C:/c/a" });
    expect(a).toMatchObject({ ok: true, account: { id: "work-max", kind: "subscription" } });
    expect(s.default).toBe("work-max");
    expect(addAccount(s, { label: "Work Max", configDir: "C:/c/b" })).toMatchObject({ ok: true, account: { id: "work-max-2" } });
    expect(addAccount(s, { label: "x", configDir: "C:/c/A" })).toMatchObject({ ok: false });
    expect(addAccount(s, { label: " " })).toMatchObject({ ok: false });
  });

  it("default dir lives under kyle-hub's own data root, not ~/.claude", () => {
    const d = defaultConfigDir("alt", { env: { LOCALAPPDATA: "C:/L" }, homedir: () => "C:/home" });
    expect(d.replace(/\\/g, "/")).toBe("C:/L/kyle-hub/claude-accounts/alt");
  });

  it("rename, set default, remove (default moves to the next account)", () => {
    const s: AccountsSettings = { list: [] };
    addAccount(s, { label: "a", configDir: "C:/1" });
    addAccount(s, { label: "b", configDir: "C:/2" });
    expect(renameAccount(s, "b", "Bee").ok).toBe(true);
    expect(s.list[1]!.label).toBe("Bee");
    expect(setDefaultAccount(s, "b").ok).toBe(true);
    expect(removeAccount(s, "b").ok).toBe(true);
    expect(s.default).toBe("a");
    expect(removeAccount(s, "zzz").ok).toBe(false);
  });

  it("accountsOf drops invalid entries and a dangling default", () => {
    const s = accountsOf({ accounts: { list: [{ id: "a", configDir: "C:/1", kind: "enterprise", profile: "work" }, { id: "a", configDir: "C:/2" }, { label: "no id" }, 5], default: "gone" } });
    expect(s.list).toHaveLength(1);
    expect(s.list[0]).toMatchObject({ id: "a", label: "a", kind: "enterprise", profile: "work" });
    expect(s.default).toBeUndefined();
    expect(accountsOf(undefined)).toEqual({ list: [], default: undefined });
  });

  it("resolves ticket > repo > default; unknown explicit ids are refused", () => {
    const s = accountsOf({ accounts: { list: [{ id: "a", configDir: "1" }, { id: "b", configDir: "2" }, { id: "c", configDir: "3" }], default: "a" } });
    expect(resolveAccount(s, {})).toMatchObject({ ok: true, account: { id: "a" } });
    expect(resolveAccount(s, { repo: "b" })).toMatchObject({ account: { id: "b" } });
    expect(resolveAccount(s, { repo: "b", ticket: "c" })).toMatchObject({ account: { id: "c" } });
    expect(resolveAccount(s, { ticket: "x" })).toMatchObject({ ok: false, reason: "unknown-account" });
    expect(resolveAccount({ list: [] }, {})).toEqual({ ok: true, account: undefined });
  });

  it("profile guard and env", () => {
    const a = { id: "w", label: "W", kind: "enterprise" as const, plan: "", configDir: "C:/w", profile: "work" as Profile };
    expect(checkAccountProfile("home", a).ok).toBe(false);
    expect(checkAccountProfile("work", a).ok).toBe(true);
    expect(checkAccountProfile("home", { ...a, profile: undefined }).ok).toBe(true);
    expect(accountEnv(a)).toEqual({ CLAUDE_CONFIG_DIR: "C:/w", KH_ACCOUNT: "w" });
    expect(accountEnv(undefined)).toEqual({});
  });
});

describe("ingest per account", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kh-acc-"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const seed = (dir: string, sid: string): void => {
    const p = path.join(dir, "projects", "proj");
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, `${sid}.jsonl`), fs.readFileSync(FIXTURE, "utf8").replaceAll("syn-session-1", sid));
    fs.writeFileSync(path.join(dir, ".credentials.json"), JSON.stringify({ accessToken: SECRET }));
  };
  const svc = () =>
    new FileLogService({
      dataRoot: (p: Profile) => path.join(root, "data", p),
      projectsDir: path.join(root, "default", "projects"),
      accounts: [
        { id: "main", configDir: path.join(root, "cfg-main") },
        { id: "alt", configDir: path.join(root, "cfg-alt") },
      ],
      prices: { "claude-test-1": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
    });

  it("tags run records and index entries with the account of the source dir; the default dir stays untagged", async () => {
    seed(path.join(root, "cfg-main"), "sess-main");
    seed(path.join(root, "cfg-alt"), "sess-alt");
    seed(path.join(root, "default"), "sess-plain");
    const s = svc();
    await s.ingest({ profile: "home" });
    const byId = Object.fromEntries((await s.runs()).map((r) => [r.runId, r.accountId]));
    expect(byId).toEqual({ "s-sess-main": "main", "s-sess-alt": "alt", "s-sess-plain": undefined });
    const header = (await collect(s.records("s-sess-alt")))[0]!;
    expect(header).toMatchObject({ type: "run", accountId: "alt" });
    expect(await s.runs({ accountId: "alt" })).toHaveLength(1);
  });

  it("never opens a credentials file, and the secret never reaches the derived logs", async () => {
    seed(path.join(root, "cfg-main"), "sess-main");
    const opened: string[] = [];
    const note = (p: unknown): void => void opened.push(String(p));
    const fp = fs.promises;
    for (const k of ["open", "readFile", "readdir", "stat"] as const) {
      const orig = fp[k] as (...a: unknown[]) => unknown;
      vi.spyOn(fp, k as never).mockImplementation(((p: unknown, ...rest: unknown[]) => (note(p), orig.call(fp, p, ...rest))) as never);
    }
    for (const k of ["readFileSync", "openSync", "createReadStream", "readdirSync", "statSync", "existsSync"] as const) {
      const orig = fs[k] as (...a: unknown[]) => unknown;
      vi.spyOn(fs, k as never).mockImplementation(((p: unknown, ...rest: unknown[]) => (note(p), orig.call(fs, p, ...rest))) as never);
    }
    await svc().ingest({ profile: "home" });
    vi.restoreAllMocks();
    expect(opened.length).toBeGreaterThan(0);
    expect(opened.filter((p) => /credentials/i.test(p))).toEqual([]);
    const all = fs.readdirSync(path.join(root, "data"), { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
    for (const e of all) expect(fs.readFileSync(path.join(e.parentPath, e.name), "utf8")).not.toContain(SECRET);
  });
});

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe("kh account", () => {
  let root: string;
  let vault: string;
  let out: string[];
  let io: Io;
  const calls: { env: Record<string, string> }[] = [];
  const deps: AccountDeps = { login: (_c, env) => (calls.push({ env }), 0), mkdirp: (d) => void fs.mkdirSync(d, { recursive: true }) };
  const data = (): { modules: { core: { accounts: AccountsSettings; repos?: Record<string, { account?: string }> } } } =>
    JSON.parse(fs.readFileSync(path.join(vault, ".obsidian", "plugins", "kyle-hub", "data.json"), "utf8"));

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kh-acli-"));
    vault = path.join(root, "vault");
    fs.mkdirSync(path.join(vault, ".obsidian", "plugins", "kyle-hub"), { recursive: true });
    fs.writeFileSync(path.join(vault, ".obsidian", "plugins", "kyle-hub", "data.json"), JSON.stringify({ schemaVersion: 1, modules: { core: { enabled: true, repos: { hub: { path: "C:/h", profile: "home" } } } } }));
    out = [];
    calls.length = 0;
    io = { cwd: root, env: { KYLE_HUB_VAULTS: vault, LOCALAPPDATA: path.join(root, "local") }, stdin: () => "", out: (s) => void out.push(s), err: (s) => void out.push(s), now: () => new Date() };
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("add creates the dir, saves, logs in with the account env; list/use/remove work", () => {
    const dir = path.join(root, "cfg-a");
    expect(runAccount(["add", "Main", "--kind", "subscription", "--plan", "max", "--dir", dir], io, deps)).toBe(0);
    expect(fs.existsSync(dir)).toBe(true);
    expect(calls[0]!.env).toEqual({ CLAUDE_CONFIG_DIR: dir, KH_ACCOUNT: "main" });
    expect(runAccount(["add", "Corp", "--kind", "enterprise", "--profile", "work", "--dir", path.join(root, "cfg-b"), "--no-login"], io, deps)).toBe(0);
    expect(calls).toHaveLength(1);
    expect(data().modules.core.accounts.default).toBe("main");
    runAccount(["use", "corp"], io, deps);
    runAccount(["use", "main", "--repo", "hub"], io, deps);
    expect(data().modules.core.accounts.default).toBe("corp");
    expect(data().modules.core.repos!.hub!.account).toBe("main");
    out.length = 0;
    runAccount(["list"], io, deps);
    expect(out.join("\n")).toMatch(/\*\tcorp/);
    expect(runAccount(["login", "corp"], io, deps)).toBe(0);
    expect(calls[1]!.env.KH_ACCOUNT).toBe("corp");
    runAccount(["remove", "corp"], io, deps);
    expect(data().modules.core.accounts.list.map((a) => a.id)).toEqual(["main"]);
    expect(fs.existsSync(path.join(root, "cfg-b"))).toBe(true);
  });

  it("rejects unknown ids and bad flags with a usage error", () => {
    expect(() => runAccount(["use", "nope"], io, deps)).toThrow(/No account/);
    expect(() => runAccount(["add", "x", "--kind", "bad"], io, deps)).toThrow(/--kind/);
  });
});
