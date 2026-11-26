import type { App } from "obsidian";
import agent from "./templates/convention-agent.md";
import human from "./templates/convention-human.md";
import { ensureVaultDir } from "./newDocModal";
import { conventionPaths, type BrainFolders } from "../../core/domain/brainPaths";

/** Vault files created once from templates, under the conventions folder setting; never injected into packs. */
export function conventionFiles(folders: BrainFolders): readonly { path: string; template: string }[] {
  const p = conventionPaths(folders);
  return [
    { path: p.agent, template: agent },
    { path: p.human, template: human },
  ];
}

/** Creates the missing convention files (existing files are never overwritten). Returns the paths created. */
export async function createConventionDocs(app: App, date: string, folders: BrainFolders): Promise<string[]> {
  const created: string[] = [];
  for (const f of conventionFiles(folders)) {
    if (await app.vault.adapter.exists(f.path)) continue;
    await ensureVaultDir(app, f.path.slice(0, f.path.lastIndexOf("/")));
    await app.vault.adapter.write(f.path, f.template.replaceAll("{{date}}", date));
    created.push(f.path);
  }
  return created;
}
