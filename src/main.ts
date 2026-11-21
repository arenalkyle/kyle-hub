import { FileSystemAdapter, Plugin } from "obsidian";
import path from "node:path";
import xtermCss from "@xterm/xterm/css/xterm.css";
import { PtyManager } from "./pty-manager";
import { resolveNode } from "./node-path";
import { DEFAULT_SETTINGS, KyleTermSettingTab, type KyleTermSettings } from "./settings";
import { KyleTermView, VIEW_TYPE } from "./view";

export default class KyleTermPlugin extends Plugin {
  override settings: KyleTermSettings = { ...DEFAULT_SETTINGS };
  private manager: PtyManager | null = null;
  private styleEl: HTMLStyleElement | null = null;

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.styleEl = document.head.createEl("style", { text: xtermCss });
    this.registerView(VIEW_TYPE, (leaf) => new KyleTermView(leaf, this));
    this.addRibbonIcon("terminal", "Open kyle-term", () => void this.activateView());
    this.addCommand({ id: "open", name: "Open terminal", callback: () => void this.activateView() });
    this.addSettingTab(new KyleTermSettingTab(this.app, this));
  }

  override onunload(): void {
    this.manager?.dispose();
    this.manager = null;
    this.styleEl?.remove();
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (existing) {
      await workspace.revealLeaf(existing);
      return;
    }
    const leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await workspace.revealLeaf(leaf);
  }

  vaultRoot(): string {
    const a = this.app.vault.adapter;
    return a instanceof FileSystemAdapter ? a.getBasePath() : process.cwd();
  }

  /** Returns the manager, or an error message string if Node can't be found. */
  getManager(): PtyManager | string {
    if (this.manager) return this.manager;
    const node = resolveNode(this.settings.nodePath);
    if (!node.ok) return node.message ?? "Node.js not found.";
    const dir = this.manifest.dir ?? "";
    const helper = path.join(this.vaultRoot(), dir, "helper", "pty-host.js");
    const m = new PtyManager(node.path, helper);
    m.onError = (msg) => console.error("[kyle-term]", msg);
    this.manager = m;
    return m;
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<KyleTermSettings> | null);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
