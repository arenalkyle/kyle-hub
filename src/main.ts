import { FileSystemAdapter, Notice, Platform, Plugin } from "obsidian";
import path from "node:path";
import os from "node:os";
import { applyToFile } from "./hook-installer";
import { HookServer } from "./hook-server";
import xtermCss from "@xterm/xterm/css/xterm.css";
import { PtyManager } from "./pty-manager";
import { resolveNode } from "./node-path";
import { DEFAULT_SETTINGS, KyleTermSettingTab, mergeSounds, type KyleTermSettings } from "./settings";
import { decideAlert, nextAttention, sessionKey, type AlertEvent } from "./alert";
import { SoundPlayer } from "./sound";
import { KyleTermView, VIEW_TYPE } from "./view";
import { SessionManager, type Session } from "./session-manager";
import { detectProfiles, type ShellProfile } from "./shells";
import { XtermSession, type TermLook } from "./xterm-session";
import {
  blurPx, buildXtermTheme, DEFAULT_APPEARANCE, mergeAppearance, obsidianPalette, resolvePalette, toHex, type Palette,
} from "./appearance";
import fs from "node:fs";

export default class KyleTermPlugin extends Plugin {
  override settings: KyleTermSettings = { ...DEFAULT_SETTINGS };
  profiles: ShellProfile[] = [];
  private pty: PtyManager | null = null;
  private sessions: SessionManager | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private hookServer: HookServer | null = null;
  private hookEnv: Record<string, string> = {};
  private player: SoundPlayer | null = null;
  private statusEl: HTMLElement | null = null;
  private xterms = new Set<XtermSession>();
  private muteListeners = new Set<() => void>();
  private lastPlayed: { bySession: Record<string, number>; byEvent: Partial<Record<AlertEvent, number>> } = { bySession: {}, byEvent: {} };

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
    this.registerEvent(this.app.workspace.on("css-change", () => this.applyAppearance()));
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
    this.addCommand({
      id: "jump-next-attention",
      name: "Jump to next session needing attention",
      hotkeys: [{ modifiers: ["Alt"], key: "a" }],
      callback: () => void this.jumpToAttention(),
    });
    this.addCommand({ id: "toggle-mute", name: "Toggle mute", callback: () => this.setMuted(!this.settings.sounds.muted) });
    this.player = new SoundPlayer(this.app);
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("mod-clickable", "kt-status");
    this.statusEl.style.display = "none";
    this.statusEl.onclick = () => void this.jumpToAttention();
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
    this.player?.dispose();
    this.player = null;
    this.muteListeners.clear();
  }

  /** Subscribe to mute changes (sidebar icon). */
  onMuteChange(cb: () => void): () => void {
    this.muteListeners.add(cb);
    return () => this.muteListeners.delete(cb);
  }

  /** Resolve a CSS variable on <body> to a computed colour string (handles hsl, var chains). */
  private readCssColor(cssVar: string): string {
    const probe = document.body.createDiv();
    probe.style.color = `var(${cssVar})`;
    probe.style.display = "none";
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }

  currentPalette(): Palette {
    return resolvePalette(this.settings.appearance, obsidianPalette((v) => this.readCssColor(v)));
  }

  termLook(): TermLook {
    const a = this.settings.appearance;
    return {
      theme: buildXtermTheme(this.currentPalette(), a.terminalOpacity),
      fontFamily: a.fontFamily || DEFAULT_APPEARANCE.fontFamily,
      fontSize: a.fontSize,
    };
  }

  /** URL for the background image, or null (with a notice when `notify`). */
  private bgUrl(notify: boolean): string | null {
    const raw = this.settings.appearance.bgImage;
    if (!raw) return null;
    try {
      if (raw.startsWith("vault:")) {
        const p = raw.slice(6);
        if (!this.app.vault.getAbstractFileByPath(p)) throw new Error("not found");
        return this.app.vault.adapter.getResourcePath(p);
      }
      if (!fs.existsSync(raw)) throw new Error("not found");
      return Platform.resourcePathPrefix + encodeURI(raw.split("\\").join("/")).replace(/#/g, "%23");
    } catch {
      if (notify) new Notice(`kyle-term: background image not found or unreadable: ${raw.replace(/^vault:/, "")}`);
      return null;
    }
  }

  /** CSS custom properties for the background layers. */
  bgVars(notify = false): Record<string, string> {
    const a = this.settings.appearance;
    const url = this.bgUrl(notify);
    return {
      "--kt-bg": toHex(this.currentPalette().background),
      "--kt-img": url ? `url("${url}")` : "none",
      "--kt-img-opacity": String(a.imageOpacity / 100),
      "--kt-img-blur": `${blurPx(a.imageBlur)}px`,
      "--kt-img-dim": String(a.imageDim / 100),
    };
  }

  /** Re-apply theme, font and background to every open terminal and view. Live, no re-creation. */
  applyAppearance(notify = false): void {
    for (const t of this.xterms) t.applyLook();
    const vars = this.bgVars(notify);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      (leaf.view as KyleTermView).applyBackground?.(vars);
    }
  }

  setMuted(v: boolean): void {
    this.settings.sounds.muted = v;
    void this.saveSettings();
    for (const l of this.muteListeners) l();
  }

  preview(sound: string, volume: number): void {
    this.player?.play(sound, volume);
  }

  /** Obsidian focused, kyle-term tab active, and this session is the visible one. */
  private isViewing(s: Session): boolean {
    if (!document.hasFocus()) return false;
    const view = this.app.workspace.getActiveViewOfType(KyleTermView);
    return !!view && this.sessions?.active?.id === s.id;
  }

  private alert(event: AlertEvent, s: Session): void {
    const now = Date.now();
    const d = decideAlert({
      event, sessionId: s.id, now, sounds: this.settings.sounds,
      viewing: this.isViewing(s), lastPlayed: this.lastPlayed,
    });
    if (!d) return;
    this.lastPlayed.bySession[sessionKey(event, s.id)] = now;
    this.lastPlayed.byEvent[event] = now;
    this.player?.play(d.sound, d.volume);
  }

  private updateStatusBar(): void {
    const el = this.statusEl;
    const m = this.sessions;
    if (!el || !m) return;
    const waiting = m.list().filter((s) => s.agent.state === "needs-input");
    if (waiting.length === 0) {
      el.style.display = "none";
      return;
    }
    el.style.display = "";
    el.setText(`⚠ ${waiting.length} need you`);
    el.setAttribute("aria-label", waiting.map((s) => m.title(s)).join("\n"));
  }

  async jumpToAttention(): Promise<void> {
    const m = this.sessions;
    if (!m) return;
    const id = nextAttention(m.list().map((s) => ({ id: s.id, state: s.agent.state })), m.active?.id ?? null);
    if (!id) return void new Notice("kyle-term: no session needs attention");
    await this.activateView();
    m.setActive(id);
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
      makeTerm: (h) => {
        const t = new XtermSession(h, () => this.termLook(), (x) => this.xterms.delete(x));
        this.xterms.add(t);
        return t;
      },
      profiles: () => this.profiles,
      env: () => this.hookEnv,
      idleMs: () => this.settings.idleSeconds * 1000,
    });
    this.sessions.onStateChange((s, _prev, next) => {
      if (next === "needs-input" || next === "finished") this.alert(next, s);
    });
    this.sessions.onSubAgentDone((s) => this.alert("sub-agent-done", s));
    this.sessions.onChange(() => this.updateStatusBar());
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
    const saved = (await this.loadData()) as Partial<KyleTermSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved, { sounds: mergeSounds(saved?.sounds), appearance: mergeAppearance(saved?.appearance) });
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
