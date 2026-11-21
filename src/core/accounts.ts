import path from "node:path";
import { dataDir, type PathDeps } from "./paths";
import { PROFILES, type Profile } from "./logs/types";
import type { GuardResult } from "./profile";

/** One Claude account: its own `CLAUDE_CONFIG_DIR` holds the login and transcripts (ADR-0012). kyle-hub never reads tokens. */
export interface Account {
  id: string;
  label: string;
  kind: "subscription" | "enterprise";
  plan: string;
  configDir: string;
  profile?: Profile;
}

/** `core.accounts` as stored in data.json. */
export interface AccountsSettings {
  list: Account[];
  /** Account id used when neither the ticket nor its repo names one. */
  default?: string;
}

export const ACCOUNT_KINDS = ["subscription", "enterprise"] as const;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined);

/** Reads `core.accounts`; entries missing an id, label or config dir are dropped, duplicate ids keep the first. */
export function accountsOf(core: object | undefined): AccountsSettings {
  const raw = (core as { accounts?: unknown } | undefined)?.accounts;
  const rawList = isObj(raw) && Array.isArray(raw.list) ? raw.list : [];
  const list: Account[] = [];
  for (const a of rawList) {
    if (!isObj(a)) continue;
    const id = str(a.id);
    const configDir = str(a.configDir);
    if (!id || !configDir || list.some((x) => x.id === id)) continue;
    const acc: Account = {
      id,
      label: str(a.label) ?? id,
      kind: a.kind === "enterprise" ? "enterprise" : "subscription",
      plan: str(a.plan) ?? "",
      configDir,
    };
    if (typeof a.profile === "string" && (PROFILES as readonly string[]).includes(a.profile)) acc.profile = a.profile as Profile;
    list.push(acc);
  }
  const def = isObj(raw) ? str(raw.default) : undefined;
  return { list, default: def && list.some((a) => a.id === def) ? def : undefined };
}

/** Lowercase `[a-z0-9-]` id from a label; never empty. */
export function accountSlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/, "") || "account";
}

/** `%LOCALAPPDATA%\kyle-hub\claude-accounts\<id>` (a dir kyle-hub owns; never `~/.claude`). */
export function defaultConfigDir(id: string, deps?: PathDeps): string {
  return path.join(path.dirname(dataDir("x", deps)), "claude-accounts", id);
}

export type AccountError = { ok: false; message: string };
export type AccountOk = { ok: true; account: Account };

export interface NewAccount {
  label: string;
  kind?: Account["kind"];
  plan?: string;
  configDir?: string;
  profile?: Profile;
  id?: string;
}

/** Adds an account to `settings` (mutates); the first account becomes the default. The caller creates the dir and opens the login tab. */
export function addAccount(settings: AccountsSettings, input: NewAccount, deps?: PathDeps): AccountOk | AccountError {
  const label = input.label.trim();
  if (!label) return { ok: false, message: "Account label is required." };
  let id = input.id ? accountSlug(input.id) : accountSlug(label);
  if (!input.id) for (let n = 2; settings.list.some((a) => a.id === id); n++) id = `${accountSlug(label)}-${n}`;
  if (settings.list.some((a) => a.id === id)) return { ok: false, message: `Account "${id}" already exists.` };
  const configDir = input.configDir?.trim() || defaultConfigDir(id, deps);
  if (settings.list.some((a) => path.resolve(a.configDir).toLowerCase() === path.resolve(configDir).toLowerCase())) {
    return { ok: false, message: `Config dir ${configDir} is already used by another account.` };
  }
  const account: Account = { id, label, kind: input.kind ?? "subscription", plan: input.plan?.trim() ?? "", configDir };
  if (input.profile) account.profile = input.profile;
  settings.list.push(account);
  if (!settings.default) settings.default = id;
  return { ok: true, account };
}

export function removeAccount(settings: AccountsSettings, id: string): GuardResult {
  const i = settings.list.findIndex((a) => a.id === id);
  if (i < 0) return { ok: false, message: `No account "${id}".` };
  settings.list.splice(i, 1);
  if (settings.default === id) settings.default = settings.list[0]?.id;
  return { ok: true, message: "" };
}

export function renameAccount(settings: AccountsSettings, id: string, label: string): GuardResult {
  const a = settings.list.find((x) => x.id === id);
  if (!a) return { ok: false, message: `No account "${id}".` };
  if (!label.trim()) return { ok: false, message: "Label is required." };
  a.label = label.trim();
  return { ok: true, message: "" };
}

export function setDefaultAccount(settings: AccountsSettings, id: string): GuardResult {
  if (!settings.list.some((a) => a.id === id)) return { ok: false, message: `No account "${id}".` };
  settings.default = id;
  return { ok: true, message: "" };
}

export type Resolved =
  | { ok: true; account?: Account }
  | { ok: false; reason: "unknown-account"; message: string };

/** Which account a launch uses: ticket override, then the repo's `account`, then the default; none configured = Claude's own default dir. */
export function resolveAccount(
  settings: AccountsSettings,
  pick: { ticket?: string; repo?: string; repoKey?: string },
): Resolved {
  const named: Array<[string | undefined, string]> = [
    [pick.ticket, "the ticket"],
    [pick.repo, `repo "${pick.repoKey ?? ""}"`],
  ];
  for (const [id, who] of named) {
    if (!id) continue;
    const a = settings.list.find((x) => x.id === id);
    if (!a) return { ok: false, reason: "unknown-account", message: `Launch refused: ${who} uses account "${id}", which is not in the account list.` };
    return { ok: true, account: a };
  }
  const d = settings.list.find((x) => x.id === settings.default);
  return { ok: true, account: d };
}

/** Launch guard: an account with a `profile` may only be used from a vault of that profile (ADR-0008, ADR-0012). */
export function checkAccountProfile(vault: Profile, account: Account): GuardResult {
  if (!account.profile || account.profile === vault) return { ok: true, message: "" };
  return {
    ok: false,
    message: `Launch refused: account "${account.label}" is a ${account.profile} account but this vault's profile is ${vault}. Pick a ${vault} account.`,
  };
}

/** Environment a session needs to run under `account`. Sets only the config dir and a marker; no credential is touched. */
export function accountEnv(account: Account | undefined): Record<string, string> {
  return account ? { CLAUDE_CONFIG_DIR: account.configDir, KH_ACCOUNT: account.id } : {};
}
