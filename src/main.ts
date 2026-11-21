import { Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import {
  createHubParts,
  createModuleContext,
  loadModules,
  type Hub,
  type HubModule,
  type ModuleContext,
  type ModuleId,
  type SectionRegistry,
} from "./core";
import { DEFAULT_FLOOD } from "./core/domain/flood";
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
  private readonly contexts = new Map<ModuleId, ModuleContext>();
  readonly sections: SectionRegistry = new Map();

  override async onload(): Promise<void> {
    const parts = createHubParts();
    parts.settings.register({ id: "core", defaults: { repos: {}, flood: { ...DEFAULT_FLOOD } } });
    parts.settings.register(ticketsSettings);
    parts.settings.register(termSettings);
    parts.settings.register({ id: "brain", defaults: {}, enabledByDefault: false });
    parts.settings.register({ id: "commandCenter", defaults: {}, enabledByDefault: false });
    parts.settings.load(await this.loadData());
    this.hub = { app: this.app, ...parts, save: () => this.saveData(parts.settings.all) };
    this.loaded = await loadModules(this.hub, MODULES, (id) => this.contextFor(id));
    this.addSettingTab(new HubSettingTab(this));
  }

  override async onunload(): Promise<void> {
    for (const m of [...this.loaded]) await this.unloadModule(m);
  }

  private contextFor(id: ModuleId): ModuleContext {
    const ctx = createModuleContext(id, this, this.hub.settings, () => this.hub.save(), this.sections);
    this.contexts.set(id, ctx);
    return ctx;
  }

  private async unloadModule(m: HubModule): Promise<void> {
    try {
      await m.unload?.();
    } finally {
      this.contexts.get(m.id)?.dispose();
      this.contexts.delete(m.id);
      this.loaded = this.loaded.filter((x) => x !== m);
    }
  }

  /** Applies the enabled flag live: unload tears down views/commands; load registers them again. */
  async setModuleEnabled(id: ModuleId, enabled: boolean): Promise<void> {
    const { settings } = this.hub;
    settings.setEnabled(id, enabled);
    await this.hub.save();
    const mod = MODULES.find((m) => m.id === id);
    if (!mod) return;
    const live = this.loaded.find((m) => m === mod);
    try {
      if (!enabled && live) await this.unloadModule(live);
      else if (enabled && !live) this.loaded.push(...(await loadModules(this.hub, [mod], (i) => this.contextFor(i))));
    } catch (e) {
      console.error(`kyle-hub: toggling ${id} failed`, e);
      new Notice(`kyle-hub: reload Obsidian to apply the ${id} change.`);
    }
  }
}

class HubSettingTab extends PluginSettingTab {
  constructor(private plugin: KyleHubPlugin) {
    super(plugin.app, plugin);
  }

  override hide(): void {
    for (const s of this.plugin.sections.values()) s.cleanup?.();
  }

  override display(): void {
    const { containerEl } = this;
    for (const s of this.plugin.sections.values()) s.cleanup?.();
    containerEl.empty();
    containerEl.createEl("h2", { text: "kyle-hub modules" });
    const { settings } = this.plugin.hub;
    for (const id of Object.keys(MODULE_LABELS) as ModuleId[]) {
      new Setting(containerEl)
        .setName(MODULE_LABELS[id])
        .setDesc(
          id === "core"
            ? "Services, events and settings every module needs."
            : id === "tickets"
              ? "Applies immediately; reload Obsidian if views do not come back."
              : "Takes effect after reloading Obsidian.",
        )
        .addToggle((t) => {
          t.setValue(settings.isEnabled(id)).onChange(async (v) => {
            if (id === "tickets") await this.plugin.setModuleEnabled(id, v);
            else {
              settings.setEnabled(id, v);
              await this.plugin.hub.save();
            }
            this.display();
          });
          if (id === "core") t.setDisabled(true);
        });
    }
    for (const [id, section] of this.plugin.sections) {
      containerEl.createEl("h2", { text: MODULE_LABELS[id] });
      section.render(containerEl.createDiv());
    }
  }
}

