import { PluginSettingTab, Setting, type App } from "obsidian";
import type KyleTermPlugin from "./main";

export interface KyleTermSettings {
  nodePath: string;
  defaultProfile: string;
  /** Empty = vault root. */
  claudeStartFolder: string;
  claudeCommand: string;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
}

export const DEFAULT_SETTINGS: KyleTermSettings = {
  nodePath: "",
  defaultProfile: "powershell",
  claudeStartFolder: "",
  claudeCommand: "claude",
  sidebarWidth: 240,
  sidebarCollapsed: false,
};

export class KyleTermSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: KyleTermPlugin) {
    super(app, plugin);
  }

  override display(): void {
    const el = this.containerEl;
    const s = this.plugin.settings;
    el.empty();
    new Setting(el)
      .setName("Node path")
      .setDesc("Path to node (18+). Leave empty to use node from PATH. Reload the plugin after changing.")
      .addText((t) =>
        t.setPlaceholder("node").setValue(s.nodePath).onChange(async (v) => {
          s.nodePath = v;
          await this.plugin.saveSettings();
        }),
      );
    new Setting(el)
      .setName("Default shell profile")
      .setDesc("Shell used by new sessions. Only installed shells are listed.")
      .addDropdown((d) => {
        for (const p of this.plugin.profiles) d.addOption(p.id, p.name);
        d.setValue(this.plugin.profiles.some((p) => p.id === s.defaultProfile) ? s.defaultProfile : this.plugin.profiles[0]!.id);
        d.onChange(async (v) => {
          s.defaultProfile = v;
          await this.plugin.saveSettings();
        });
      });
    new Setting(el)
      .setName("Claude start folder")
      .setDesc("Folder where New Session starts. Leave empty for the vault root.")
      .addText((t) =>
        t.setPlaceholder("(vault root)").setValue(s.claudeStartFolder).onChange(async (v) => {
          s.claudeStartFolder = v.trim();
          await this.plugin.saveSettings();
        }),
      );
    new Setting(el)
      .setName("Claude command")
      .setDesc("Typed into the shell when starting a Claude session.")
      .addText((t) =>
        t.setPlaceholder("claude").setValue(s.claudeCommand).onChange(async (v) => {
          s.claudeCommand = v.trim() || "claude";
          await this.plugin.saveSettings();
        }),
      );
  }
}
