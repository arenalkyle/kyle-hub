import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const PATH_MARKER = "__KT__";

/** Directories Homebrew/npm commonly install into on macOS (added only if they exist). */
export function fallbackDirs(home: string): string[] {
  return [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    path.posix.join(home, ".local", "bin"),
    path.posix.join(home, ".npm-global", "bin"),
  ];
}

/** Extract the PATH printed between markers (interactive shells may print banners). */
export function parseMarkedPath(stdout: string): string | null {
  const m = new RegExp(`${PATH_MARKER}([^]*?)${PATH_MARKER}`).exec(stdout);
  const v = m?.[1]?.trim();
  return v ? v : null;
}

/** Merge PATH lists, de-duplicating while keeping first-seen order. Separator is platform specific. */
export function mergePath(lists: Array<string | undefined | null>, platform: string): string {
  const sep = platform === "win32" ? ";" : ":";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lists) {
    for (const part of (l ?? "").split(sep)) {
      const p = part.trim();
      if (p && !seen.has(p)) { seen.add(p); out.push(p); }
    }
  }
  return out.join(sep);
}

export interface PathDeps {
  platform: string;
  env: Record<string, string | undefined>;
  home: string;
  exists(p: string): boolean;
  /** Prints the login shell's PATH, or null on failure/timeout. */
  probe(shell: string): Promise<string | null>;
}

/**
 * The PATH kyle-term uses for the helper and every PTY. Windows (and other non-macOS)
 * keep `process.env.PATH` untouched. On macOS: login-shell PATH, then current PATH,
 * then existing fallback dirs.
 */
export async function resolvePath(deps: PathDeps): Promise<string> {
  const current = deps.env.PATH ?? "";
  if (deps.platform !== "darwin") return current;
  const probed = await deps.probe(deps.env.SHELL || "/bin/bash");
  const fallbacks = fallbackDirs(deps.home).filter((d) => deps.exists(d)).join(":");
  return mergePath([probed, current, fallbacks], "darwin");
}

export const realPathDeps = (): PathDeps => ({
  platform: process.platform,
  env: process.env,
  home: process.env.HOME ?? "",
  exists: existsSync,
  probe: (shell) =>
    new Promise((resolve) => {
      try {
        execFile(shell, ["-ilc", `printf "${PATH_MARKER}%s${PATH_MARKER}" "$PATH"`], { timeout: 3000, encoding: "utf8" }, (err, stdout) => {
          resolve(err && !stdout ? null : parseMarkedPath(String(stdout)));
        });
      } catch { resolve(null); }
    }),
});
