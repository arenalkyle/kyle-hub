import { Notice, TFile, type EventRef } from "obsidian";
import type { EventBus, Hub, ModuleContext } from "../../../core";
import { defaultSettings } from "../../../core/domain/defaults";
import { parsePrUrl } from "../../../core/domain/pr";
import type { Settings } from "../../../core/domain/types";
import type { PluginData } from "./data";
import { dataFromNamespace } from "./migrate";
import { KyleTicketsSettingTab } from "./settings/SettingsTab";
import { guardStatusChange, doneConfirmMessage, overrideEventText } from "../../../core/domain/transition";
import type { IssuePatch } from "../../../core/domain/issueFile";
import { confirmModal } from "./settings/modals";
import { SetupModal } from "./settings/SetupModal";
import { renderAgentsDoc } from "../../../core/domain/agentsDoc";
import { bootstrapFolder, ensureBaseSlices, syncAgentsDoc } from "./settings/bootstrap";
import { MainView, VIEW_TYPE_MAIN } from "./views/MainView";
import { NewIssueModal, type NewIssueDefaults } from "./views/NewIssueModal";
import { IssueStore } from "./store/IssueStore";
import { AutoLinker } from "./github/autolink";
import { PrService } from "./github/PrService";
import { IssueView, VIEW_TYPE_ISSUE } from "./views/IssueView";
import { IssueInterceptor } from "./views/intercept";
import { NewProjectModal } from "./views/NewProjectModal";
import { ProjectView, VIEW_TYPE_PROJECT } from "./views/ProjectView";
import { linkIssueIds } from "./views/idLinks";
import { checkGh } from "./github/gh";
import { setGhLogin } from "./github/login";

/**
 * The tickets module's runtime: what the Plugin subclass was in kyle-tickets, now driven by
 * `load(hub, ctx)`. Views and UI code keep calling the same members they always did.
 */
export default class TicketsHost {
  data: PluginData;
  readonly store: IssueStore;
  readonly interceptor: IssueInterceptor;
  /** Live PR state via the `gh` CLI. */
  readonly prs: PrService;
  /** Auto-links PRs of watched repos by issue ID. */
  readonly autoLinker: AutoLinker;

  constructor(
    readonly hub: Hub,
    private readonly ctx: ModuleContext,
  ) {
    this.data = dataFromNamespace(ctx.settings.get());
    this.store = new IssueStore(this);
    this.interceptor = new IssueInterceptor(this);
    this.prs = new PrService(this);
    this.autoLinker = new AutoLinker(this);
  }

  get app() {
    return this.hub.app;
  }

  get bus(): EventBus {
    return this.hub.events;
  }

  registerEvent(ref: EventRef): void {
    this.ctx.registerEvent(ref);
  }

  register(cb: () => unknown): void {
    this.ctx.register(cb);
  }

  start(): void {
    this.ctx.registerView(VIEW_TYPE_MAIN, (leaf) => new MainView(leaf, this));
    this.ctx.registerView(VIEW_TYPE_ISSUE, (leaf) => new IssueView(leaf, this));
    this.ctx.registerView(VIEW_TYPE_PROJECT, (leaf) => new ProjectView(leaf, this));
    this.interceptor.install();
    this.ctx.registerMarkdownPostProcessor((el) =>
      linkIssueIds(el, this.data.settings.prefix, (id) => this.store.pathOf(id) !== undefined),
    );
    this.ctx.addCommand({
      id: "toggle-issue-markdown",
      name: "Toggle issue / Markdown view",
      checkCallback: (check) => this.interceptor.toggle(check),
    });
    this.ctx.addRibbonIcon("kanban-square", "kyle-tickets", () => void this.activateMainView());
    this.ctx.addCommand({
      id: "open",
      name: "Open kyle-tickets",
      callback: () => void this.activateMainView(),
    });
    this.ctx.addCommand({
      id: "new-issue",
      name: "New issue",
      callback: () => this.openNewIssue(),
    });
    this.ctx.addCommand({
      id: "new-project",
      name: "New project",
      callback: () => this.openNewProject(),
    });
    const tab = new KyleTicketsSettingTab(this.app, this);
    this.ctx.addSettingsSection({
      render: (el) => {
        tab.containerEl = el;
        tab.display();
      },
      cleanup: () => tab.hide(),
    });

    this.app.workspace.onLayoutReady(() => {
      if (this.data.setupDone) {
        void this.syncAgents();
        void ensureBaseSlices(this.app.vault.adapter, this.data.settings).catch((e) => console.error("kyle-tickets: could not write .base files", e));
      }
      void this.store.start().then(() => {
        void this.prs.refreshAll();
        void this.autoLinker.tick();
      });
      if (!this.data.setupDone) this.openSetup();
      // One `gh auth status` call at startup; avatars read the cached login.
      void checkGh().then((s) => setGhLogin(s.ok ? s.user : undefined), () => setGhLogin(undefined));
    });
    // Background PR refresh: a 1-minute tick; staleness is judged against the `prRefreshMinutes` setting.
    this.ctx.registerInterval(
      window.setInterval(() => {
        void this.prs.refreshAll();
        void this.autoLinker.tick();
      }, 60_000),
    );
  }

  /** Stops background work; views, commands, ribbon icon and settings section go with `ctx.dispose()`. */
  stop(): void {
    this.store.stop();
    this.autoLinker.stop();
    this.prs.stop();
  }

  /** Every PR url held by any issue (for background refresh). */
  allPrUrls(): string[] {
    return this.store.getIssues().flatMap((i) => i.pullRequests.map((u) => parsePrUrl(u)?.url ?? u));
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

  /** Opens a project's file, which the interceptor turns into the project page. */
  openProject(name: string, newTab = false): void {
    const path = this.store.pathOfProject(name);
    const f = path ? this.app.vault.getAbstractFileByPath(path) : null;
    if (f instanceof TFile) void this.app.workspace.getLeaf(newTab ? "tab" : false).openFile(f);
  }

  openNewProject(): void {
    new NewProjectModal(this).open();
  }

  async savePluginData(): Promise<void> {
    await this.ctx.settings.update({ ...this.data });
    void this.syncAgents();
  }

  private lastAgentsKey = "";

  /** Regenerates `<folder>/AGENTS.md` (no-op when unchanged or user-edited). */
  async syncAgents(): Promise<void> {
    if (!this.data.setupDone && !(await this.app.vault.adapter.exists(`${this.data.settings.folder}/Issues`))) return;
    const key = renderAgentsDoc(this.data.settings) + this.data.settings.folder;
    if (key === this.lastAgentsKey) return;
    this.lastAgentsKey = key;
    try {
      await syncAgentsDoc(this.app.vault.adapter, this.data.settings);
    } catch (e) {
      console.error("kyle-tickets: could not write AGENTS.md", e);
    }
  }

  async bootstrap(): Promise<void> {
    const { folder, prefix } = this.data.settings;
    await bootstrapFolder(this.app.vault.adapter, folder, prefix, this.data.settings.statuses);
    await this.syncAgents();
  }

  /** Repo map from the hub's core settings (key = a ticket's `repo`). */
  repoKeys(): string[] {
    return Object.keys((this.hub.settings.module("core").repos as Record<string, unknown> | undefined) ?? {}).sort();
  }

  /**
   * Done gate (ADR-0005) for UI status changes: resolves `{ ok: false }` when the user cancels the
   * confirm, else `{ ok: true, note }` where `note` is the override event to log after the write.
   */
  async confirmStatus(id: string, patch: IssuePatch): Promise<{ ok: boolean; note?: string }> {
    const issue = this.store.getIssue(id);
    if (!issue || patch.status === undefined || patch.status === null) return { ok: true };
    const g = guardStatusChange(issue, patch.status, this.data.settings.statuses);
    if (g.ok) return { ok: true };
    const yes = await confirmModal(this.app, "Unchecked criteria", doneConfirmMessage(g), "Mark done", true);
    return yes ? { ok: true, note: overrideEventText(g.unchecked) } : { ok: false };
  }

  /** The single UI path for ticket updates: applies the Done gate, writes, logs an override. False when cancelled. */
  async updateIssue(id: string, patch: IssuePatch, gate?: { ok: boolean; note?: string }): Promise<boolean> {
    const g = gate ?? (await this.confirmStatus(id, patch));
    if (!g.ok) return false;
    await this.store.updateIssue(id, patch);
    if (g.note) await this.store.logEvent(id, g.note);
    return true;
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
