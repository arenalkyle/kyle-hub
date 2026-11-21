import { FileSystemAdapter, Notice, Plugin } from "obsidian";
import path from "node:path";
import os from "node:os";
import { applyToFile } from "./hook-installer";
import { HookServer } from "./hook-server";
import xtermCss from "@xterm/xterm/css/xterm.css";
import { PtyManager } from "./pty-manager";
import { resolveNode } from "./node-path";
import { DEFAULT_SETTINGS, KyleTermSettingTab, type KyleTermSettings } from "./settings";
import { KyleTermView, VIEW_TYPE } from "./view";
import { SessionManager } from "./session-manager";
import { detectProfiles, type ShellProfile } from "./shells";
import { XtermSession } from "./xterm-session";

export default class KyleTermPlugin extends Plugin {
  override settings: KyleTermSettings = { ...DEFAULT_SETTINGS };
  profiles: ShellProfile[] = [];
  private pty: PtyManager | null = null;
  private sessions: SessionManager | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private hookServer: HookServer | null = null;
  private hookEnv: Record<string, string> = {};

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.profiles = detectProfiles();
    this.styleEl = document.head.createEl("style", { text: xtermCss });
    const server = new HookServer((m) => this.sessions?.handleHook(m.session, m.event, m.payload));
    try {
      await server.start();
      this.hookServer = server;
      this.hookEnv = { KYLE_TERM_PORT: String(server.port), KYLE_TERM_TOKEN: server.token };
    } catch (e) {
      console.error("[kyle-term] hook server failed to start", e);
    }
    this.registerView(VIEW_TYPE, (leaf) => new KyleTermView(leaf, this));
    this.addRibbonIcon("terminal", "Open kyle-term", () => void this.activateView());
    this.addCommand({ id: "open", name: "Open terminal", callback: () => void this.activateView() });
    this.addCommand({
      id: "new-terminal",
      name: "New terminal",
      hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "T" }],
      callback: () => void this.newShell(true),
    });
    this.addCommand({ id: "new-claude-session", name: "New Claude session", callback: () => void this.newClaude(true) });
    this.addCommand({
      id: "next-session",
      name: "Next session",
      hotkeys: [{ modifiers: ["Ctrl"], key: "Tab" }],
      callback: () => this.sessions?.next(),
    });
    this.addCommand({
      id: "previous-session",
      name: "Previous session",
      hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "Tab" }],
      callback: () => this.sessions?.prev(),
    });
    this.addCommand({ id: "install-hooks", name: "Install hooks", callback: () => this.hooks("install") });
    this.addCommand({ id: "uninstall-hooks", name: "Uninstall hooks", callback: () => this.hooks("uninstall") });
    this.addSettingTab(new KyleTermSettingTab(this.app, this));
  }

  override onunload(): void {
    this.hookServer?.stop();
    this.hookServer = null;
    this.sessions?.dispose();
    this.sessions = null;
    this.pty?.dispose();
    this.pty = null;
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

  defaultProfileId(): string {
    const id = this.settings.defaultProfile;
    return this.profiles.some((p) => p.id === id) ? id : this.profiles[0]!.id;
  }

  /** Returns the session manager, or an error message string if Node can't be found. */
  getSessions(): SessionManager | string {
    if (this.sessions) return this.sessions;
    const node = resolveNode(this.settings.nodePath);
    if (!node.ok) return node.message ?? "Node.js not found.";
    const dir = this.manifest.dir ?? "";
    const helper = path.join(this.vaultRoot(), dir, "helper", "pty-host.js");
    const pty = new PtyManager(node.path, helper);
    pty.onError = (msg) => console.error("[kyle-term]", msg);
    this.pty = pty;
    this.sessions = new SessionManager({
      pty,
      makeTerm: (h) => new XtermSession(h),
      profiles: () => this.profiles,
      env: () => this.hookEnv,
      idleMs: () => this.settings.idleSeconds * 1000,
    });
    return this.sessions;
  }

  private hooks(mode: "install" | "uninstall"): void {
    const script = path.join(this.vaultRoot(), this.manifest.dir ?? "", "hooks", "kyle-hook.js");
    const r = applyToFile(path.join(os.homedir(), ".claude", "settings.json"), mode, script);
    new Notice(`kyle-term: ${r.message}`, r.ok ? 6000 : 12000);
  }

  async newShell(reveal = false): Promise<void> {
    const m = this.getSessions();
    if (typeof m === "string") return void new Notice(m);
    m.create({ kind: "shell", profileId: this.defaultProfileId(), cwd: this.vaultRoot() });
    if (reveal) await this.activateView();
  }

  async newClaude(reveal = false): Promise<void> {
    const m = this.getSessions();
    if (typeof m === "string") return void new Notice(m);
    m.create({
      kind: "claude",
      profileId: this.defaultProfileId(),
      cwd: this.settings.claudeStartFolder || this.vaultRoot(),
      command: this.settings.claudeCommand || "claude",
    });
    if (reveal) await this.activateView();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<KyleTermSettings> | null);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
