import os from "node:os";
import path from "node:path";

export const PLUGIN_ID = "kyle-hub";

export interface PathDeps {
  env: Record<string, string | undefined>;
  homedir: () => string;
}

const realDeps: PathDeps = { env: process.env, homedir: () => os.homedir() };

/** `%LOCALAPPDATA%\kyle-hub\<profile>\` (falls back to `<home>\AppData\Local` when unset). */
export function dataDir(profile = "default", deps: PathDeps = realDeps): string {
  const base = deps.env.LOCALAPPDATA || path.join(deps.homedir(), "AppData", "Local");
  return path.join(base, PLUGIN_ID, profile);
}

/** `<vault>\<configDir>\plugins\kyle-hub`. */
export function pluginDir(vaultBase: string, configDir = ".obsidian"): string {
  return path.join(vaultBase, configDir, "plugins", PLUGIN_ID);
}
