import { PluginSettingTab, Setting, type App } from "obsidian";
import type KyleTermPlugin from "./main";

export interface KyleTermSettings {
  nodePath: string;
}

export const DEFAULT_SETTINGS: KyleTermSettings = { nodePath: "" };

export class KyleTermSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: KyleTermPlugin) {
    super(app, plugin);
  }

  override display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName("Node path")
      .setDesc("Path to node (18+). Leave empty to use node from PATH. Reload the plugin after changing.")
      .addText((t) =>
        t.setPlaceholder("node").setValue(this.plugin.settings.nodePath).onChange(async (v) => {
          this.plugin.settings.nodePath = v;
          await this.plugin.saveSettings();
        }),
      );
  }
}
