import fs from "node:fs";
import path from "node:path";
import { brainFolders, type BrainFolders } from "../domain/brainPaths";

/**
 * A vault's brain folders, read from its kyle-hub `data.json` (`modules.brain.brainFolder` / `conventionsFolder`).
 * Defaults (`Brain`, `Brain/conventions`) when the file or the keys are missing or unreadable.
 */
export function readVaultBrainFolders(vaultRoot: string, configDir = ".obsidian"): BrainFolders {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(vaultRoot, configDir, "plugins", "kyle-hub", "data.json"), "utf8")) as {
      modules?: { brain?: { brainFolder?: unknown; conventionsFolder?: unknown } };
    };
    return brainFolders(data?.modules?.brain);
  } catch {
    return brainFolders(undefined);
  }
}
