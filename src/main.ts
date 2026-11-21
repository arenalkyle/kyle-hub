import { homedir } from "node:os";
import { Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { runDoctorChecks } from "./core/ops/environment";
import { logServiceFromSettings, type CoreSettingsLike } from "./core/logs/hubService";
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
import { brainModule, brainSettings } from "./modules/brain";
import { commandCenterModule } from "./modules/command-center";

const MODULES: HubModule[] = [ticketsModule, termModule, brainModule, commandCenterModule];
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
    parts.settings.register({ id: "core", defaults: { repos: {}, flood: { ...DEFAULT_FLOOD }, launch: { maxConcurrentRuns: 3, defaultModel: "sonnet" } } });
    parts.settings.register(ticketsSettings);
    parts.settings.register(termSettings);
    parts.settings.register(brainSettings);
    parts.settings.register({ id: "commandCenter", defaults: {}, enabledByDefault: false });
    parts.settings.load(await this.loadData());
    this.hub = { app: this.app, ...parts, save: () => this.saveData(parts.settings.all) };
    parts.services.register("logs", logServiceFromSettings(parts.settings.module("core") as CoreSettingsLike));
    this.loaded = await loadModules(this.hub, MODULES, (id) => this.contextFor(id));
    this.addSettingTab(new HubSettingTab(this));
  }

  override async onunload(): Promise<void> {
    for (const m of [...this.loaded]) await this.unloadModule(m);
    this.hub.services.unregister("logs");
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
    this.displayRepos(containerEl);
    containerEl.createEl("h2", { text: "Log health" });
    const doctorOut = containerEl.createDiv();
    new Setting(containerEl)
      .setName("Doctor")
      .setDesc("Checks cleanupPeriodDays, the kyle-hook registration, the kyle-hub-maintain task and the log folders.")
      .addButton((b) =>
        b.setButtonText("Run doctor").onClick(() => {
          doctorOut.empty();
          for (const c of runDoctorChecks(process.env, homedir())) doctorOut.createEl("p", { text: `[${c.status}] ${c.id}: ${c.message}` });
        }),
      );
  }

  /** Repo map (`core.repos`) and launch limits, used by the term module's queue. */
  private displayRepos(el: HTMLElement): void {
    const core = this.plugin.hub.settings.module("core") as Record<string, unknown>;
    const repos = (core.repos ??= {}) as Record<string, { path: string; profile: "work" | "home"; worktrees: boolean; github?: string }>;
    const launch = (core.launch ??= { maxConcurrentRuns: 3, defaultModel: "sonnet" }) as { maxConcurrentRuns: number; defaultModel: string };
    const save = () => this.plugin.hub.save();
    el.createEl("h2", { text: "Repo map and launch" });
    new Setting(el).setName("Max concurrent runs").addText((t) =>
      t.setValue(String(launch.maxConcurrentRuns)).onChange(async (v) => {
        const n = Math.floor(Number(v));
        launch.maxConcurrentRuns = Number.isFinite(n) && n >= 1 ? n : 3;
        await save();
      }),
    );
    new Setting(el).setName("Default model").setDesc("Used when a ticket has no model.").addDropdown((d) =>
      d.addOptions({ haiku: "haiku", sonnet: "sonnet", opus: "opus" }).setValue(launch.defaultModel).onChange(async (v) => {
        launch.defaultModel = v;
        await save();
      }),
    );
    for (const [key, r] of Object.entries(repos)) {
      new Setting(el)
        .setName(key)
        .setDesc(`${r.path} · ${r.profile} · ${r.worktrees === false ? "no worktrees" : "worktrees"}`)
        .addButton((b) => b.setButtonText("Remove").onClick(async () => {
          delete repos[key];
          await save();
          this.display();
        }));
    }
    let key = "";
    let dir = "";
    let profile: "work" | "home" = "home";
    let worktrees = true;
    new Setting(el)
      .setName("Add repo")
      .setDesc("Key (used in a ticket's repo field), absolute path, profile, worktree per ticket.")
      .addText((t) => t.setPlaceholder("key").onChange((v) => (key = v.trim())))
      .addText((t) => t.setPlaceholder("C:\path\to\repo").onChange((v) => (dir = v.trim())))
      .addDropdown((d) => d.addOptions({ home: "home", work: "work" }).setValue(profile).onChange((v) => (profile = v as "work" | "home")))
      .addToggle((t) => t.setValue(worktrees).onChange((v) => (worktrees = v)))
      .addButton((b) => b.setButtonText("Add").setCta().onClick(async () => {
        if (!key || !dir) return void new Notice("kyle-hub: key and path are required.");
        repos[key] = { path: dir, profile, worktrees };
        await save();
        this.display();
      }));
  }
}
