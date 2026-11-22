import fs from "node:fs";
import path from "node:path";

export const TEMPLATE_IDS = ["linear-ticket-out", "linear-ticket-in", "repo-note", "daily-reminder", "skill-proposal", "script-proposal"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];
export type TemplateDefaults = Record<TemplateId, string>;

/** Stable id to file name, both in the shipped defaults folder and in `<vault>/.kyle-hub/templates/`. */
export const TEMPLATE_FILES: Record<TemplateId, string> = {
  "linear-ticket-out": "linear-ticket-out.md",
  "linear-ticket-in": "linear-ticket-in.md",
  "repo-note": "repo-note.md",
  "daily-reminder": "daily-reminder.md",
  "skill-proposal": "skill-proposal.md",
  "script-proposal": "script-proposal.md",
};

/** Vault folder, relative to the vault root. Committed to git; `.kyle-hub/gaps/` is the ignored one. */
export const TEMPLATES_DIR = path.join(".kyle-hub", "templates");

export function templatePath(vaultRoot: string, id: TemplateId): string {
  return path.join(vaultRoot, TEMPLATES_DIR, TEMPLATE_FILES[id]);
}

export function hasVaultTemplate(vaultRoot: string, id: TemplateId): boolean {
  return fs.existsSync(templatePath(vaultRoot, id));
}

/**
 * The vault file when present, else the shipped default. Reads fresh on every call (no cache, no watcher),
 * so a file edited by an agent applies on the next use without a reload.
 */
export function readTemplate(vaultRoot: string | undefined, id: TemplateId, defaults: TemplateDefaults): string {
  if (vaultRoot !== undefined) {
    try {
      return fs.readFileSync(templatePath(vaultRoot, id), "utf8");
    } catch {
      /* missing or unreadable override: fall back to the shipped default */
    }
  }
  return defaults[id];
}

export function writeTemplate(vaultRoot: string, id: TemplateId, text: string): void {
  fs.mkdirSync(path.join(vaultRoot, TEMPLATES_DIR), { recursive: true });
  fs.writeFileSync(templatePath(vaultRoot, id), text, "utf8");
}

/** Deletes the vault override so the default applies again. A missing file is not an error. */
export function resetTemplate(vaultRoot: string, id: TemplateId): void {
  fs.rmSync(templatePath(vaultRoot, id), { force: true });
}
