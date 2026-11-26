import type { NetworkInterfaceInfo } from "node:os";

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
