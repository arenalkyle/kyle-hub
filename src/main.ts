import { Plugin, PluginSettingTab, Setting } from "obsidian";
import { createHubParts, loadModules, type Hub, type HubModule, type ModuleId } from "./core";
import { termModule, termSettings } from "./modules/term";
import { ticketsModule, ticketsSettings } from "./modules/tickets";

const MODULES: HubModule[] = [ticketsModule, termModule];
const MODULE_LABELS: Record<ModuleId, string> = {
  core: "Core (always on)",
  tickets: "Tickets",
  term: "Terminals",
  brain: "Brain",
  commandCenter: "Command center",
};

export default class KyleHubPlugin extends Plugin {
  hub!: Hub;
  private loaded: HubModule[] = [];

  override async onload(): Promise<void> {
    const parts = createHubParts();
    parts.settings.register({ id: "core", defaults: {} });
    parts.settings.register(ticketsSettings);
    parts.settings.register(termSettings);
    parts.settings.register({ id: "brain", defaults: {}, enabledByDefault: false });
    parts.settings.register({ id: "commandCenter", defaults: {}, enabledByDefault: false });
    parts.settings.load(await this.loadData());
    this.hub = { app: this.app, ...parts, save: () => this.saveData(parts.settings.all) };
    this.loaded = await loadModules(this.hub, MODULES);
    this.addSettingTab(new HubSettingTab(this));
  }

  override async onunload(): Promise<void> {
    for (const m of this.loaded) await m.unload?.();
    this.loaded = [];
  }
}

class HubSettingTab extends PluginSettingTab {
  constructor(private plugin: KyleHubPlugin) {
    super(plugin.app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "kyle-hub modules" });
    const { settings } = this.plugin.hub;
    for (const id of Object.keys(MODULE_LABELS) as ModuleId[]) {
      new Setting(containerEl)
        .setName(MODULE_LABELS[id])
        .setDesc(id === "core" ? "Services, events and settings every module needs." : "Takes effect after reloading Obsidian.")
        .addToggle((t) => {
          t.setValue(settings.isEnabled(id)).onChange(async (v) => {
            settings.setEnabled(id, v);
            await this.plugin.hub.save();
          });
          if (id === "core") t.setDisabled(true);
        });
    }
  }
}
