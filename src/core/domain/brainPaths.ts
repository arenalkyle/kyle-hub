/**
 * Where the brain lives in a vault. Pure (no fs, no obsidian): shared by the plugin, `core/brain` and the CLI.
 *
 * - `brainFolder` (default `Brain`): every `.md` under it is linted and counted as a brain doc, new vault docs go to
 *   `<brainFolder>/<type>/`, and promote writes lessons to `<brainFolder>/lessons/`. Point it only at a folder that
 *   holds brain docs; a general `docs/` folder would lint unrelated notes.
 * - `conventionsFolder` (default `<brainFolder>/conventions`): the style conventions (`agent.md`, `human.md`). Set it
 *   on its own to keep conventions in a versioned folder such as `docs/conventions` without scanning the rest.
 */
export const DEFAULT_BRAIN_FOLDER = "Brain";

export interface BrainFolders {
  /** Vault-relative, forward slashes, no leading or trailing slash. */
  brainFolder: string;
  /** Vault-relative, forward slashes, no leading or trailing slash. */
  conventionsFolder: string;
}

/**
 * Normalises a vault-relative folder setting: trims, uses forward slashes, drops `./`, leading and trailing slashes and
 * empty segments. Returns "" for anything empty, absolute (drive letter or UNC) or escaping the vault (`..`).
 */
export function normalizeVaultFolder(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const s = raw.trim().replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(s) || s.startsWith("//")) return "";
  const parts = s.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === "..")) return "";
  return parts.join("/");
}

/** Resolves the brain settings (`modules.brain`) to folders, applying the defaults. */
export function brainFolders(settings: { brainFolder?: unknown; conventionsFolder?: unknown } | undefined): BrainFolders {
  const brainFolder = normalizeVaultFolder(settings?.brainFolder) || DEFAULT_BRAIN_FOLDER;
  const conventionsFolder = normalizeVaultFolder(settings?.conventionsFolder) || `${brainFolder}/conventions`;
  return { brainFolder, conventionsFolder };
}

/** Vault paths of the two convention files. */
export const conventionPaths = (f: BrainFolders): { agent: string; human: string } => ({
  agent: `${f.conventionsFolder}/agent.md`,
  human: `${f.conventionsFolder}/human.md`,
});

/** Vault path of a promoted lesson. */
export const lessonPath = (brainFolder: string, fileName: string): string => `${brainFolder}/lessons/${fileName}`;

/**
 * Brain-scene layout cache entries for notes and folders that still exist (`folder/` keys are folders). Drops positions
 * left behind when notes move, e.g. the old `Brain/` tree after the brain folder setting changes.
 */
export function pruneLayoutKeys<T>(stored: Record<string, T>, exists: (vaultPath: string) => boolean): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(stored)) {
    const p = k.endsWith("/") ? k.slice(0, -1) : k;
    if (p === "" || exists(p)) out[k] = v;
  }
  return out;
}
