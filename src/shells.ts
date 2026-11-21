import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type ProfileId = "powershell" | "pwsh" | "gitbash" | "cmd" | "bash";

export interface ShellProfile {
  id: ProfileId;
  name: string;
  shell: string;
  args: string[];
}

export interface DetectDeps {
  platform: string;
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
    const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { encoding: "utf8", windowsHide: true, timeout: 5000 });
    if (r.error || r.status !== 0) return null;
    return r.stdout.split(/\r?\n/)[0]?.trim() || null;
  },
};

/** Detect available shell profiles once at startup. First entry is the fallback. */
export function detectProfiles(deps: DetectDeps = realDeps): ShellProfile[] {
  if (deps.platform !== "win32") {
    return [{ id: "bash", name: "Shell", shell: deps.env.SHELL || "/bin/bash", args: ["-l"] }];
  }
  const out: ShellProfile[] = [{ id: "powershell", name: "PowerShell 5.1", shell: "powershell.exe", args: ["-NoLogo"] }];
  if (deps.where("pwsh")) out.push({ id: "pwsh", name: "PowerShell 7", shell: "pwsh.exe", args: ["-NoLogo"] });
  const candidates = [path.win32.join(deps.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe")];
  const git = deps.where("git");
  if (git) candidates.push(path.win32.join(path.win32.dirname(path.win32.dirname(git)), "bin", "bash.exe"));
  const bash = candidates.find((c) => deps.exists(c));
  if (bash) out.push({ id: "gitbash", name: "Git Bash", shell: bash, args: ["--login", "-i"] });
  out.push({ id: "cmd", name: "Command Prompt", shell: "cmd.exe", args: [] });
  return out;
}
