import os from "node:os";
import path from "node:path";

export const PLUGIN_ID = "kyle-hub";

export interface PathDeps {
  env: Record<string, string | undefined>;
  homedir: () => string;
  platform?: NodeJS.Platform;
}

const realDeps: PathDeps = { env: process.env, homedir: () => os.homedir(), platform: process.platform };

/**
 * `%LOCALAPPDATA%\kyle-hub\<profile>\` (falls back to `<home>\AppData\Local` when unset). On macOS/Linux, with no
 * LOCALAPPDATA override, `~/Library/Application Support` or `$XDG_DATA_HOME` (`~/.local/share`).
 */
export function dataDir(profile = "default", deps: PathDeps = realDeps): string {
  const base = deps.env.LOCALAPPDATA || unixBase(deps) || path.join(deps.homedir(), "AppData", "Local");
  return path.join(base, PLUGIN_ID, profile);
}

function unixBase(deps: PathDeps): string | undefined {
  if (!deps.platform || deps.platform === "win32") return undefined;
  if (deps.platform === "darwin") return path.join(deps.homedir(), "Library", "Application Support");
  return deps.env.XDG_DATA_HOME || path.join(deps.homedir(), ".local", "share");
}

/** `<vault>\<configDir>\plugins\kyle-hub`. */
export function pluginDir(vaultBase: string, configDir = ".obsidian"): string {
  return path.join(vaultBase, configDir, "plugins", PLUGIN_ID);
}
