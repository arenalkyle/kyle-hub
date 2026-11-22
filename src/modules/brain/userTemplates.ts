import { Notice, Setting } from "obsidian";
import type { SettingsSection } from "../../core/context";
import {
  hasVaultTemplate,
  readTemplate,
  resetTemplate,
  TEMPLATE_FILES,
  TEMPLATE_IDS,
  type TemplateDefaults,
  writeTemplate,
} from "../../core/templates";
import linearTicketOut from "./templates/linear-ticket-out.md";
import linearTicketIn from "./templates/linear-ticket-in.md";
import repoNote from "./templates/repo-note.md";
import dailyReminder from "./templates/daily-reminder.md";
import skillProposal from "./templates/skill-proposal.md";
import scriptProposal from "./templates/script-proposal.md";

/** Shipped defaults, used when `<vault>/.kyle-hub/templates/<id>.md` is absent. */
export const TEMPLATE_DEFAULTS: TemplateDefaults = {
  "linear-ticket-out": linearTicketOut,
  "linear-ticket-in": linearTicketIn,
  "repo-note": repoNote,
  "daily-reminder": dailyReminder,
  "skill-proposal": skillProposal,
  "script-proposal": scriptProposal,
};

/** Settings block: one text editor per template, Save writes the vault file, Reset deletes it. */
export class UserTemplatesSection implements SettingsSection {
  constructor(private readonly vaultRoot: () => string | undefined) {}

  render(el: HTMLElement): void {
    el.empty();
    const root = this.vaultRoot();
    if (root === undefined) {
      el.createEl("p", { text: "Templates need a filesystem vault." });
      return;
    }
    el.createEl("p", { cls: "kh-brain-templates-desc", text: "Stored in .kyle-hub/templates/ in the vault. Reset deletes the vault file and falls back to the built-in default." });
    for (const id of TEMPLATE_IDS) {
      const custom = hasVaultTemplate(root, id);
      const row = el.createDiv({ cls: "kh-brain-templates-row" });
      new Setting(row).setName(id).setDesc(`${TEMPLATE_FILES[id]} (${custom ? "vault file" : "default"})`);
      const area = row.createEl("textarea", { cls: "kh-brain-templates-text" });
      area.value = readTemplate(root, id, TEMPLATE_DEFAULTS);
      new Setting(row)
        .addButton((b) =>
          b.setButtonText("Save").setCta().onClick(() => {
            writeTemplate(root, id, area.value);
            new Notice(`kyle-hub: saved ${TEMPLATE_FILES[id]}`);
            this.render(el);
          }),
        )
        .addButton((b) =>
          b.setButtonText("Reset to default").onClick(() => {
            resetTemplate(root, id);
            this.render(el);
          }),
        );
    }
  }
}
