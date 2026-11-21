import { PROFILES, type Profile } from "./logs/types";

export type { Profile };

/** Vault-level profile (`core.profile`); anything unrecognised is `home`. */
export function vaultProfileOf(core: object | undefined): Profile {
  const p = (core as { profile?: unknown } | undefined)?.profile;
  return typeof p === "string" && (PROFILES as readonly string[]).includes(p) ? (p as Profile) : "home";
}

export interface GuardResult {
  ok: boolean;
  message: string;
}

/** Launch guard: a repo may only be launched from a vault with the same profile (ADR-0008). */
export function checkProfileMatch(vault: Profile, repo: Profile, repoKey: string): GuardResult {
  if (vault === repo) return { ok: true, message: "" };
  return {
    ok: false,
    message: `Launch refused: repo "${repoKey}" is a ${repo} repo but this vault's profile is ${vault}. Open the ${repo} vault to launch it.`,
  };
}
