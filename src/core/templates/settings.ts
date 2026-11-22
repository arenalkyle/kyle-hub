import { Notice, Setting } from "obsidian";
import type { SettingsSection } from "../context";
import {
  hasVaultTemplate,
  readTemplate,
  resetTemplate,
  TEMPLATE_FILES,
  TEMPLATE_IDS,
  writeTemplate,
} from "./index";

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
    el.createEl("p", { cls: "kh-core-templates-desc", text: "Stored in .kyle-hub/templates/ in the vault. Reset deletes the vault file and falls back to the built-in default." });
    for (const id of TEMPLATE_IDS) {
      const custom = hasVaultTemplate(root, id);
      const row = el.createDiv({ cls: "kh-core-templates-row" });
      new Setting(row).setName(id).setDesc(`${TEMPLATE_FILES[id]} (${custom ? "vault file" : "default"})`);
      const area = row.createEl("textarea", { cls: "kh-core-templates-text" });
      area.value = readTemplate(root, id);
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
