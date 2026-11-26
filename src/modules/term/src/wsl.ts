import type { NetworkInterfaceInfo } from "node:os";
import type { ShellProfile } from "./shells";

/** True for a vault opened through the WSL file share (`\\wsl$\<distro>\...` or `\\wsl.localhost\<distro>\...`). */
export function isWslUncPath(p: string): boolean {
  return /^[\\/]{2}wsl(\$|\.localhost)[\\/]/i.test(p);
}

/** Env keys a Linux process inside WSL needs from the Windows side: the hook transport and the launcher's KH_* vars. */
const forwarded = (k: string): boolean => k.startsWith("KYLE_TERM_") || k.startsWith("KH_");

/**
 * Adds our keys to `WSLENV` so `wsl.exe` passes them into the Linux shell (Windows env vars do not cross otherwise).
 * `/u` = only Windows -> WSL. Keeps entries already in `existing`; no-op when nothing needs forwarding.
 */
export function withWslEnv(env: Record<string, string>, existing = ""): Record<string, string> {
  const keys = Object.keys(env).filter(forwarded);
  if (keys.length === 0) return env;
  const entries = existing.split(":").filter((e) => e.length > 0);
  const have = new Set(entries.map((e) => e.split("/")[0]));
  for (const k of keys) if (!have.has(k)) entries.push(`${k}/u`);
  return { ...env, WSLENV: entries.join(":") };
}

/**
 * IPv4 address of the Windows side of the WSL2 NAT network (`vEthernet (WSL)`, or `vEthernet (WSL (Hyper-V firewall))`
 * on newer builds). Inside WSL this address is the default gateway. Undefined when WSL is not running.
 */
export function wslAdapterAddress(ifaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string | undefined {
  for (const [name, list] of Object.entries(ifaces)) {
    if (!/^vEthernet \(WSL/i.test(name) || !list) continue;
    const v4 = list.find((i) => i.family === "IPv4" && !i.internal);
    if (v4) return v4.address;
  }
  return undefined;
}

/** `\\wsl.localhost\Ubuntu\home\me\v` -> `{ distro: "Ubuntu", linuxPath: "/home/me/v" }`; null for any other path. */
export function parseWslUnc(p: string): { distro: string; linuxPath: string } | null {
  const m = /^[\\/]{2}wsl(?:\$|\.localhost)[\\/]([^\\/]+)([\\/].*)?$/i.exec(p);
  if (!m) return null;
  const rest = (m[2] ?? "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/(.)\/$/, "$1");
  return { distro: m[1]!, linuxPath: rest || "/" };
}

export const WSL_PROFILE_ID = "wsl";

/** Shell profile that opens the vault's distro in the vault folder; null when the vault is not on the WSL share. */
export function wslProfile(vaultRoot: string): ShellProfile | null {
  const w = parseWslUnc(vaultRoot);
  if (!w) return null;
  return { id: WSL_PROFILE_ID, name: `WSL (${w.distro})`, shell: "wsl.exe", args: ["-d", w.distro, "--cd", w.linuxPath], distro: w.distro };
}

/** Arguments for one spawn: a WSL profile cds into the session's folder (converted to Linux); others are unchanged. */
export function spawnArgs(p: ShellProfile, cwd: string): string[] {
  if (!p.distro) return p.args;
  const w = parseWslUnc(cwd);
  return w ? ["-d", w.distro, "--cd", w.linuxPath] : p.args;
}

/**
 * Profile for a new session: a folder on the WSL share opens in WSL (so Claude is the Linux `claude` with Linux
 * `~/.claude`); any other folder uses the saved default among the non-WSL profiles.
 */
export function chooseProfileId(cwd: string, saved: string, profiles: ShellProfile[]): string {
  const wsl = profiles.find((p) => p.distro);
  if (wsl && isWslUncPath(cwd)) return wsl.id;
  const native = profiles.filter((p) => !p.distro);
  return native.some((p) => p.id === saved) ? saved : (native[0] ?? profiles[0]!).id;
}

/**
 * Saved sessions in a vault on the WSL share all reopen in WSL; one saved with a folder outside the share (the old
 * Windows copy of the vault) restarts in the vault root. No-op for any other vault.
 */
export function adaptRestored<T extends { profileId: string; cwd: string }>(sessions: T[], vaultRoot: string): T[] {
  if (!isWslUncPath(vaultRoot)) return sessions;
  return sessions.map((s) => ({ ...s, profileId: WSL_PROFILE_ID, cwd: isWslUncPath(s.cwd) ? s.cwd : vaultRoot }));
}
