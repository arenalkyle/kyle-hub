import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type ProfileId = "powershell" | "pwsh" | "gitbash" | "cmd" | "login" | "zsh" | "bash";

export interface ShellProfile {
  id: ProfileId;
  name: string;
  shell: string;
  args: string[];
}

export interface DetectDeps {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  exists(p: string): boolean;
  /** First path printed by `where`/`which`, or null. */
  where(cmd: string): string | null;
}

export const realDeps: DetectDeps = {
  platform: process.platform,
  env: process.env,
  exists: existsSync,
  where(cmd) {
    const finder = process.platform === "win32" ? "where" : "which";
    const r = spawnSync(finder, [cmd], { encoding: "utf8", windowsHide: true, timeout: 5000 });
    if (r.error || r.status !== 0) return null;
    return r.stdout.split(/\r?\n/)[0]?.trim() || null;
  },
};

/** Detect available shell profiles once at startup. First entry is the fallback. */
export function detectProfiles(deps: DetectDeps = realDeps): ShellProfile[] {
  return deps.platform === "win32" ? windowsProfiles(deps) : unixProfiles(deps);
}

function windowsProfiles(deps: DetectDeps): ShellProfile[] {
  const out: ShellProfile[] = [{ id: "powershell", name: "PowerShell 5.1", shell: "powershell.exe", args: ["-NoLogo"] }];
  if (deps.where("pwsh")) out.push({ id: "pwsh", name: "PowerShell 7", shell: "pwsh.exe", args: ["-NoLogo"] });
  const candidates = [path.win32.join(deps.env.ProgramFiles ?? "C:\Program Files", "Git", "bin", "bash.exe")];
  const git = deps.where("git");
  if (git) candidates.push(path.win32.join(path.win32.dirname(path.win32.dirname(git)), "bin", "bash.exe"));
  const bash = candidates.find((c) => deps.exists(c));
  if (bash) out.push({ id: "gitbash", name: "Git Bash", shell: bash, args: ["--login", "-i"] });
  out.push({ id: "cmd", name: "Command Prompt", shell: "cmd.exe", args: [] });
  return out;
}

/**
 * macOS/Linux: the user's login shell ($SHELL) first, then zsh and bash. Shells start as login shells so they read
 * the user's profile: apps launched from the Dock get a minimal PATH without Homebrew, nvm or `claude`.
 */
function unixProfiles(deps: DetectDeps): ShellProfile[] {
  const out: ShellProfile[] = [];
  const login = deps.env.SHELL?.trim();
  if (login && deps.exists(login)) out.push({ id: "login", name: `Login shell (${path.posix.basename(login)})`, shell: login, args: ["-l"] });
  for (const id of ["zsh", "bash"] as const) {
    const p = [`/bin/${id}`, `/usr/bin/${id}`].find((c) => deps.exists(c)) ?? deps.where(id);
    if (p && p !== login) out.push({ id, name: id, shell: p, args: ["-l"] });
  }
  if (out.length === 0) out.push({ id: "login", name: "sh", shell: "/bin/sh", args: ["-l"] });
  return out;
}

/** A saved profile id no longer detected falls back to the default (first). */
export function pickProfileId(saved: string, profiles: ShellProfile[]): string {
  return profiles.some((p) => p.id === saved) ? saved : profiles[0]!.id;
}
