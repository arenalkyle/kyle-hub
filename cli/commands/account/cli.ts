import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { accountEnv, accountsOf, addAccount, removeAccount, setDefaultAccount, type AccountsSettings } from "../../../src/core/accounts";
import { EXIT, KtError, type Io } from "../tickets/cli";

const USAGE =
  "kh account <list [--json] | add <label> [--kind subscription|enterprise] [--plan <p>] [--profile home|work] [--dir <configDir>] [--no-login] | login <id> | use <id> [--repo <key>] | remove <id>>";
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export interface AccountDeps {
  /** Runs the interactive `claude` with the account's env, inheriting the terminal; returns its exit code. */
  login(command: string, env: Record<string, string>): number;
  mkdirp(dir: string): void;
}

export const defaultAccountDeps: AccountDeps = {
  login: (command, env) => spawnSync(command, [], { stdio: "inherit", shell: true, env: { ...process.env, ...env } }).status ?? 1,
  mkdirp: (dir) => void fs.mkdirSync(dir, { recursive: true }),
};

function dataFile(env: Record<string, string | undefined>): string {
  const vault = (env.KYLE_HUB_VAULTS ?? env.KYLE_TICKETS_VAULTS ?? "").split(";").map((s) => s.trim()).find((s) => s.length > 0);
  if (!vault) throw new KtError(EXIT.usage, "No vault configured (set KYLE_HUB_VAULTS).");
  return path.join(vault, ".obsidian", "plugins", "kyle-hub", "data.json");
}

/** The first vault's data.json and its `modules.core` section (created when missing). Obsidian rewrites this file on save, so reload the plugin after a change. */
function load(file: string): { root: Obj; core: Obj } {
  let root: Obj = {};
  try {
    const d: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (isObj(d)) root = d;
  } catch {
    /* new file */
  }
  if (!isObj(root.modules)) root.modules = {};
  const modules = root.modules as Obj;
  if (!isObj(modules.core)) modules.core = { enabled: true };
  return { root, core: modules.core as Obj };
}

const save = (file: string, root: Obj): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(root, null, 2));
};

/** `kh account list|add|login|use|remove`: the account registry in `core.accounts`; never reads or writes credentials. */
export function runAccount(argv: string[], io: Io, deps: AccountDeps = defaultAccountDeps): number {
  const [sub, ...rest] = argv;
  if (sub === undefined || sub === "--help" || sub === "-h" || sub === "help") {
    io.out(USAGE);
    return EXIT.ok;
  }
  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      options: { json: { type: "boolean" }, kind: { type: "string" }, plan: { type: "string" }, profile: { type: "string" }, dir: { type: "string" }, repo: { type: "string" }, "no-login": { type: "boolean" } },
      strict: true,
      allowPositionals: true,
    });
  } catch (e) {
    throw new KtError(EXIT.usage, `${(e as Error).message}. Usage: ${USAGE}`);
  }
  const { values: v, positionals: pos } = parsed;
  const file = dataFile(io.env);
  const { root, core } = load(file);
  const acc: AccountsSettings = accountsOf(core);
  core.accounts = acc;
  const fail = (message: string): never => {
    throw new KtError(EXIT.usage, message);
  };
  const need = (n: string): string => {
    const x = pos[0];
    if (!x || pos.length > 1) return fail(`Missing or extra ${n}. Usage: ${USAGE}`);
    return x;
  };
  const find = (id: string) => acc.list.find((a) => a.id === id) ?? fail(`No account "${id}". Run kh account list.`);
  const doLogin = (id: string): number => {
    const a = find(id);
    deps.mkdirp(a.configDir);
    io.out(`Logging in ${a.label}: run /login in the session below, then exit.`);
    return deps.login("claude", accountEnv(a)) === 0 ? EXIT.ok : EXIT.remote;
  };
  switch (sub) {
    case "list": {
      if (v.json) io.out(JSON.stringify(acc, null, 2));
      else {
        for (const a of acc.list) io.out([a.id === acc.default ? "*" : " ", a.id, a.label, a.kind, a.plan || "-", a.profile ?? "any", a.configDir].join("\t"));
        io.out(`${acc.list.length} account(s)`);
      }
      return EXIT.ok;
    }
    case "add": {
      const label = need("label");
      if (v.kind !== undefined && v.kind !== "subscription" && v.kind !== "enterprise") fail("--kind must be subscription or enterprise.");
      if (v.profile !== undefined && v.profile !== "home" && v.profile !== "work") fail("--profile must be home or work.");
      const r = addAccount(
        acc,
        { label, kind: v.kind as "subscription" | "enterprise" | undefined, plan: v.plan, configDir: v.dir, profile: v.profile as "home" | "work" | undefined },
        { env: io.env, homedir: os.homedir },
      );
      if (!r.ok) return fail(r.message);
      deps.mkdirp(r.account.configDir);
      save(file, root);
      io.out(`Added account ${r.account.id} (${r.account.configDir})${acc.default === r.account.id ? " as default" : ""}.`);
      return v["no-login"] ? EXIT.ok : doLogin(r.account.id);
    }
    case "login":
      return doLogin(need("id"));
    case "use": {
      const id = need("id");
      find(id);
      if (v.repo) {
        const repos = isObj(core.repos) ? core.repos : {};
        const repo = repos[v.repo];
        if (!isObj(repo)) return fail(`No repo "${v.repo}" in the repo map.`);
        repo.account = id;
        io.out(`Repo ${v.repo} now defaults to account ${id}.`);
      } else {
        setDefaultAccount(acc, id);
        io.out(`Default account is now ${id}.`);
      }
      save(file, root);
      return EXIT.ok;
    }
    case "remove": {
      const id = need("id");
      find(id);
      removeAccount(acc, id);
      save(file, root);
      io.out(`Removed account ${id} from the registry (its config dir is left on disk).`);
      return EXIT.ok;
    }
    default:
      throw new KtError(EXIT.usage, `Usage: ${USAGE}`);
  }
}
