import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { FileSystemAdapter, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { runDoctorChecks } from "./core/ops/environment";
import { logServiceFromSettings, type CoreSettingsLike } from "./core/logs/hubService";
import {
  createHubParts,
  createModuleContext,
  NavRegistry,
  renderNav,
  loadModules,
  type Hub,
  type HubModule,
  type ModuleContext,
  type ModuleId,
  type SectionRegistry,
} from "./core";
import { DEFAULT_FLOOD } from "./core/domain/flood";
import { DEFAULT_PUBLIC_HOSTS } from "./core/domain/scrub";
import { accountEnv, accountsOf, addAccount, removeAccount, renameAccount, setDefaultAccount, type Account, type AccountsSettings } from "./core/accounts";
import { vaultProfileOf } from "./core/profile";
import { termModule, termSettings } from "./modules/term";
import { ticketsModule, ticketsSettings } from "./modules/tickets";
import { brainModule, brainSettings } from "./modules/brain";
import { commandCenterModule } from "./modules/command-center";
import { usageModule, usageSettings } from "./modules/usage";

const MODULES: HubModule[] = [ticketsModule, termModule, brainModule, commandCenterModule, usageModule];
const MODULE_LABELS: Record<ModuleId, string> = {
  core: "Core (always on)",
  tickets: "Tickets",
  term: "Terminals",
  brain: "Brain",
  commandCenter: "Command Center",
  usage: "Usage tracker",
};

export default class KyleHubPlugin extends Plugin {
  hub!: Hub;
  private loaded: HubModule[] = [];
  private readonly contexts = new Map<ModuleId, ModuleContext>();
  readonly sections: SectionRegistry = new Map();
  readonly nav = new NavRegistry();

  override async onload(): Promise<void> {
    const parts = createHubParts();
    parts.settings.register({ id: "core", defaults: { repos: {}, accounts: { list: [], default: "" }, profile: "home", promote: { homeVaultPath: "", publicHosts: [...DEFAULT_PUBLIC_HOSTS], denylist: [] }, flood: { ...DEFAULT_FLOOD }, launch: { maxConcurrentRuns: 3, defaultModel: "sonnet" } } });
    parts.settings.register(ticketsSettings);
    parts.settings.register(termSettings);
    parts.settings.register(brainSettings);
    parts.settings.register(usageSettings);
    parts.settings.register({ id: "commandCenter", defaults: {}, enabledByDefault: false });
    parts.settings.load(await this.loadData());
    this.hub = { app: this.app, ...parts, save: () => this.saveData(parts.settings.all) };
    parts.services.register("logs", logServiceFromSettings(parts.settings.module("core") as CoreSettingsLike));
    this.loaded = await loadModules(this.hub, MODULES, (id) => this.contextFor(id));
    this.addSettingTab(new HubSettingTab(this));
    const paint = (): void => renderNav(this.app, this.nav);
    this.nav.onChange(paint);
    this.registerEvent(this.app.workspace.on("layout-change", paint));
    this.registerEvent(this.app.workspace.on("active-leaf-change", paint));
    this.app.workspace.onLayoutReady(paint);
  }

  override async onunload(): Promise<void> {
    for (const m of [...this.loaded]) await this.unloadModule(m);
    this.hub.services.unregister("logs");
  }

  private contextFor(id: ModuleId): ModuleContext {
    const ctx = createModuleContext(id, this, this.hub.settings, () => this.hub.save(), this.sections, this.nav);
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
    this.displayProfile(containerEl);
    this.displayAccounts(containerEl);
    this.displayRepos(containerEl);
    containerEl.createEl("h2", { text: "Log health" });
    const doctorOut = containerEl.createDiv();
    new Setting(containerEl)
      .setName("Doctor")
      .setDesc("Checks cleanupPeriodDays, the kyle-hook registration, the kyle-hub-maintain task and the log folders.")
      .addButton((b) =>
        b.setButtonText("Run doctor").onClick(() => {
          doctorOut.empty();
          for (const c of runDoctorChecks(process.env, homedir(), undefined, this.app.vault.adapter instanceof FileSystemAdapter ? [this.app.vault.adapter.getBasePath()] : undefined)) doctorOut.createEl("p", { text: `[${c.status}] ${c.id}: ${c.message}` });
        }),
      );
  }

  /** Vault profile (work | home) and Promote settings (ADR-0008). */
  private displayProfile(el: HTMLElement): void {
    const core = this.plugin.hub.settings.module("core") as Record<string, unknown>;
    const promote = (core.promote ??= { homeVaultPath: "", publicHosts: [...DEFAULT_PUBLIC_HOSTS], denylist: [] }) as {
      homeVaultPath: string;
      publicHosts: string[];
      denylist: string[];
    };
    const save = () => this.plugin.hub.save();
    const list = (s: string): string[] => s.split(/[\n,]/).map((x) => x.trim()).filter((x) => x.length > 0);
    el.createEl("h2", { text: "Profile and promote" });
    new Setting(el)
      .setName("Vault profile")
      .setDesc("work or home. Launching a repo of the other profile is refused; the dashboard and retro read only this profile's logs. Work vaults keep no excerpts.")
      .addDropdown((d) =>
        d.addOptions({ home: "home", work: "work" }).setValue(vaultProfileOf(core)).onChange(async (v) => {
          core.profile = v;
          await save();
        }),
      );
    new Setting(el).setName("Home vault path").setDesc("Promote writes to <path>/Brain/lessons/.").addText((t) =>
      t.setPlaceholder("Path to the home vault").setValue(promote.homeVaultPath).onChange(async (v) => {
        promote.homeVaultPath = v.trim();
        await save();
      }),
    );
    new Setting(el).setName("Public hosts").setDesc("Comma or newline separated. URLs on other hosts are replaced when promoting.").addTextArea((t) =>
      t.setValue(promote.publicHosts.join("\n")).onChange(async (v) => {
        promote.publicHosts = list(v);
        await save();
      }),
    );
    new Setting(el).setName("Denylist").setDesc("Extra terms to scrub (repo-map keys and GitHub orgs are always scrubbed).").addTextArea((t) =>
      t.setValue(promote.denylist.join("\n")).onChange(async (v) => {
        promote.denylist = list(v);
        await save();
      }),
    );
  }

  /** Claude accounts (`core.accounts`): one CLAUDE_CONFIG_DIR each (ADR-0012). kyle-hub never reads or stores tokens. */
  private displayAccounts(el: HTMLElement): void {
    const core = this.plugin.hub.settings.module("core") as Record<string, unknown>;
    const acc = (core.accounts ??= { list: [], default: "" }) as AccountsSettings;
    const view = accountsOf(core);
    acc.list = view.list;
    acc.default = view.default;
    const save = () => this.plugin.hub.save();
    const login = (a: Account): void => {
      const sessions = this.plugin.hub.services.get("sessions");
      if (!sessions) return void new Notice("kyle-hub: enable the Terminals module to log in from Obsidian.");
      mkdirSync(a.configDir, { recursive: true });
      sessions.spawn({ command: "claude", env: accountEnv(a), title: `Login: ${a.label}` });
      new Notice(`kyle-hub: run /login in the new tab (${a.label}).`);
    };
    el.createEl("h2", { text: "Claude accounts" });
    el = el.createDiv({ cls: "kh-accounts" });
    el.createEl("p", { cls: "setting-item-description", text: "Each account has its own CLAUDE_CONFIG_DIR (login and transcripts stay separate). kyle-hub only sets the env var and opens a login tab; it never reads or stores tokens." });
    for (const a of acc.list) {
      new Setting(el)
        .setName(`${a.label}${acc.default === a.id ? " (default)" : ""}`)
        .setDesc(`${a.kind}${a.plan ? ` ${a.plan}` : ""}${a.profile ? ` · ${a.profile}` : ""} · ${a.configDir}`)
        .addButton((b) => b.setButtonText("Login").onClick(() => login(a)))
        .addButton((b) => b.setButtonText("Rename").onClick(async () => {
          const label = window.prompt("New label", a.label);
          if (label === null) return;
          const r = renameAccount(acc, a.id, label);
          if (!r.ok) return void new Notice(`kyle-hub: ${r.message}`);
          await save();
          this.display();
        }))
        .addButton((b) => b.setButtonText("Set default").setDisabled(acc.default === a.id).onClick(async () => {
          setDefaultAccount(acc, a.id);
          await save();
          this.display();
        }))
        .addButton((b) => b.setButtonText("Remove").onClick(async () => {
          removeAccount(acc, a.id);
          await save();
          this.display();
        }));
    }
    let label = "";
    let kind: Account["kind"] = "subscription";
    let plan = "";
    let profile = "";
    new Setting(el)
      .setName("Add account")
      .setDesc("Label, kind, plan, profile (optional; a profile-bound account is refused in the other vault). Creates the config dir and opens a login tab.")
      .addText((t) => t.setPlaceholder("label").onChange((v) => (label = v)))
      .addDropdown((d) => d.addOptions({ subscription: "subscription", enterprise: "enterprise" }).setValue(kind).onChange((v) => (kind = v as Account["kind"])))
      .addText((t) => t.setPlaceholder("plan (max, team...)").onChange((v) => (plan = v)))
      .addDropdown((d) => d.addOptions({ "": "any profile", home: "home", work: "work" }).setValue(profile).onChange((v) => (profile = v)))
      .addButton((b) => b.setButtonText("Add").setCta().onClick(async () => {
        const r = addAccount(acc, { label, kind, plan, profile: profile === "home" || profile === "work" ? profile : undefined });
        if (!r.ok) return void new Notice(`kyle-hub: ${r.message}`);
        await save();
        login(r.account);
        this.display();
      }));
  }

  /** Repo map (`core.repos`) and launch limits, used by the term module's queue. */
  private displayRepos(el: HTMLElement): void {
    const core = this.plugin.hub.settings.module("core") as Record<string, unknown>;
    const repos = (core.repos ??= {}) as Record<string, { path: string; profile: "work" | "home"; worktrees: boolean; github?: string; account?: string }>;
    const launch = (core.launch ??= { maxConcurrentRuns: 3, defaultModel: "sonnet" }) as { maxConcurrentRuns: number; defaultModel: string };
    const save = () => this.plugin.hub.save();
    el.createEl("h2", { text: "Repo map and launch" });
    el = el.createDiv({ cls: "kh-accounts" });
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
        .addDropdown((d) =>
          d.addOptions({ "": "default account", ...Object.fromEntries(accountsOf(core).list.map((a) => [a.id, a.label])) }).setValue(r.account ?? "").onChange(async (v) => {
            if (v) r.account = v;
            else delete r.account;
            await save();
          }),
        )
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
