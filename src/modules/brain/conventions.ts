import type { App } from "obsidian";
import agent from "./templates/convention-agent.md";
import human from "./templates/convention-human.md";
import { ensureVaultDir } from "./newDocModal";

/** Vault files created once from templates; never injected into packs. */
export const CONVENTION_FILES: readonly { path: string; template: string }[] = [
  { path: "Brain/conventions/agent.md", template: agent },
  { path: "Brain/conventions/human.md", template: human },
];

/** Creates the missing convention files (existing files are never overwritten). Returns the paths created. */
export async function createConventionDocs(app: App, date: string): Promise<string[]> {
  const created: string[] = [];
  for (const f of CONVENTION_FILES) {
    if (await app.vault.adapter.exists(f.path)) continue;
    await ensureVaultDir(app, f.path.slice(0, f.path.lastIndexOf("/")));
    await app.vault.adapter.write(f.path, f.template.replaceAll("{{date}}", date));
    created.push(f.path);
  }
  return created;
}
