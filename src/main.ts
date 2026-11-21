import { Notice, Plugin, TFile } from "obsidian";
import { defaultSettings } from "./core/defaults";
import type { Settings } from "./core/types";
import { mergeData, type PluginData } from "./data";
import { KyleTicketsSettingTab } from "./settings/SettingsTab";
import { SetupModal } from "./settings/SetupModal";
import { bootstrapFolder } from "./settings/bootstrap";
import { MainView, VIEW_TYPE_MAIN } from "./views/MainView";
import { NewIssueModal, type NewIssueDefaults } from "./views/NewIssueModal";
import { IssueStore } from "./store/IssueStore";

export default class KyleTicketsPlugin extends Plugin {
  data: PluginData = mergeData(null);
  /** Public for debugging: `app.plugins.plugins["kyle-tickets"].store`. */
  readonly store = new IssueStore(this);

  override async onload(): Promise<void> {
    this.data = mergeData(await this.loadData());

    this.registerView(VIEW_TYPE_MAIN, (leaf) => new MainView(leaf, this));
    this.addRibbonIcon("kanban-square", "kyle-tickets", () => void this.activateMainView());
    this.addCommand({
      id: "open",
      name: "Open kyle-tickets",
      callback: () => void this.activateMainView(),
    });
    this.addCommand({
      id: "new-issue",
      name: "New issue",
      callback: () => this.openNewIssue(),
    });
    this.addSettingTab(new KyleTicketsSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      void this.store.start();
      if (!this.data.setupDone) this.openSetup();
    });
  }

  override onunload(): void {
    this.store.stop();
    // Views, commands, ribbon icons and the settings tab are cleaned up by Plugin.
  }

  private readonly settingsListeners = new Set<() => void>();

  /** Subscribe to settings changes made through `updateSettings`. */
  onSettingsChange(cb: () => void): () => void {
    this.settingsListeners.add(cb);
    return () => {
      this.settingsListeners.delete(cb);
    };
  }

  /** Replaces `data.settings` with a new object (so memoized views re-render), saves and notifies. */
  async updateSettings(patch: Partial<Settings>): Promise<void> {
    this.data.settings = { ...this.data.settings, ...patch };
    for (const l of [...this.settingsListeners]) l();
    await this.savePluginData();
  }

  /** Opens an issue's file (in a new tab or the current leaf). */
  openIssue(id: string, newTab = false): void {
    const path = this.store.pathOf(id);
    const f = path ? this.app.vault.getAbstractFileByPath(path) : null;
    if (f instanceof TFile) void this.app.workspace.getLeaf(newTab ? "tab" : false).openFile(f);
  }

  async savePluginData(): Promise<void> {
    await this.saveData(this.data);
  }

  async bootstrap(): Promise<void> {
    const { folder, prefix } = this.data.settings;
    await bootstrapFolder(this.app.vault.adapter, folder, prefix);
  }

  /** Opens the New issue window; `defaults` pre-fill status/project/parent. */
  openNewIssue(defaults: NewIssueDefaults = {}): void {
    new NewIssueModal(this, defaults).open();
  }

  async activateMainView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_MAIN)[0];
    if (existing) {
      await workspace.revealLeaf(existing);
      return;
    }
    const leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_MAIN, active: true });
    await workspace.revealLeaf(leaf);
  }

  private openSetup(): void {
    const d = defaultSettings();
    const s = this.data.settings;
    new SetupModal(
      this.app,
      { folder: s.folder || d.folder, prefix: s.prefix || d.prefix, displayName: s.displayName || d.displayName },
      async (r) => {
        Object.assign(this.data.settings, r);
        await this.bootstrap();
        this.data.setupDone = true;
        await this.savePluginData();
        new Notice(`kyle-tickets: created ${r.folder}/`);
      },
    ).open();
  }
}
