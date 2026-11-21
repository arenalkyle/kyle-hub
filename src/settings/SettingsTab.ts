import { Modal, Notice, PluginSettingTab, Setting, type App } from "obsidian";
import type KyleTicketsPlugin from "../main";
import { FolderSuggest } from "./SetupModal";
import { normalizeFolder, validateFolder, validatePrefix } from "./validate";

class ConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly message: string,
    private readonly onYes: () => Promise<void>,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle("kyle-tickets");
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((b) =>
        b
          .setButtonText("Create structure")
          .setCta()
          .onClick(async () => {
            this.close();
            await this.onYes();
          }),
      )
      .addButton((b) => b.setButtonText("Not now").onClick(() => this.close()));
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

export class KyleTicketsSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: KyleTicketsPlugin,
  ) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.data.settings;

    new Setting(containerEl)
      .setName("Tickets folder")
      .setDesc("Changing this does not move existing files.")
      .addText((t) => {
        t.setValue(s.folder).onChange(async (x) => {
          const folder = normalizeFolder(x);
          const err = validateFolder(folder);
          t.inputEl.toggleClass("kt-invalid", err !== null);
          if (err || folder === s.folder) return;
          s.folder = folder;
          await this.plugin.savePluginData();
        });
        t.inputEl.addEventListener("blur", () => void this.offerStructure());
        new FolderSuggest(this.app, t.inputEl);
      });

    new Setting(containerEl)
      .setName("ID prefix")
      .setDesc("Uppercase letters/digits, starting with a letter. Applies to new issues.")
      .addText((t) =>
        t.setValue(s.prefix).onChange(async (x) => {
          const err = validatePrefix(x);
          t.inputEl.toggleClass("kt-invalid", err !== null);
          if (err) return;
          s.prefix = x;
          await this.plugin.savePluginData();
        }),
      );

    new Setting(containerEl)
      .setName("Display name")
      .setDesc("Default @author for comments and activity.")
      .addText((t) =>
        t.setValue(s.displayName).onChange(async (x) => {
          s.displayName = x.trim() || "kyle";
          await this.plugin.savePluginData();
        }),
      );
  }

  private async offerStructure(): Promise<void> {
    const { folder } = this.plugin.data.settings;
    if (await this.app.vault.adapter.exists(`${folder}/Issues`)) return;
    new ConfirmModal(this.app, `Create the kyle-tickets structure in "${folder}"?`, async () => {
      await this.plugin.bootstrap();
      new Notice(`kyle-tickets: created structure in ${folder}`);
    }).open();
  }
}
