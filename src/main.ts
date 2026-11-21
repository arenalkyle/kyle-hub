import { FileSystemAdapter, Menu, Notice, Platform, Plugin, TFile, TFolder, type TAbstractFile } from "obsidian";
import { FolderSuggest } from "./folder-suggest";
import { buildRefs, parseDropText } from "./vault-paths";
import path from "node:path";
import os from "node:os";
import { applyToFile } from "./hook-installer";
import { HookServer } from "./hook-server";
import xtermCss from "@xterm/xterm/css/xterm.css";
import { PtyManager } from "./pty-manager";
import { resolveNode } from "./node-path";
import { realPathDeps, resolvePath } from "./path-env";
import { DEFAULT_SETTINGS, KyleTermSettingTab, mergeSounds, type KyleTermSettings } from "./settings";
import { decideAlert, nextAttention, sessionKey, type AlertEvent } from "./alert";
import { SoundPlayer } from "./sound";
import { KyleTermView, VIEW_TYPE } from "./view";
import { SessionManager, type Session } from "./session-manager";
import { detectProfiles, pickProfileId, type ShellProfile } from "./shells";
import { XtermSession, type TermLook } from "./xterm-session";
import {
  blurPx, buildXtermTheme, DEFAULT_FONT_FAMILY, mergeAppearance, resolveFontFamily, obsidianPalette, resolvePalette, shouldUseWebgl, toHex, type Palette,
} from "./appearance";
import fs from "node:fs";
import { orphanFiles, parsePersisted, PERSIST_VERSION, scrollbackFile, type PersistedSession } from "./persist";

const PERSIST_DEBOUNCE_MS = 2000;
const SCROLLBACK_SAVE_MS = 30_000;

export default class KyleTermPlugin extends Plugin {
  override settings: KyleTermSettings = { ...DEFAULT_SETTINGS };
  profiles: ShellProfile[] = [];
  /** Login-shell PATH on macOS (cached for the session); null elsewhere, where process.env is used as-is. */
  resolvedPath: string | null = null;
  nodeInfo = "";
  private pty: PtyManager | null = null;
  private sessions: SessionManager | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private hookServer: HookServer | null = null;
  private hookEnv: Record<string, string> = {};
  private player: SoundPlayer | null = null;
  private statusEl: HTMLElement | null = null;
  private xterms = new Set<XtermSession>();
  private savedSessions: PersistedSession[] = [];
  private persistTimer?: ReturnType<typeof setTimeout>;
  private muteListeners = new Set<() => void>();
  private lastPlayed: { bySession: Record<string, number>; byEvent: Partial<Record<AlertEvent, number>> } = { bySession: {}, byEvent: {} };

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.profiles = detectProfiles();
    if (process.platform === "darwin") this.resolvedPath = await resolvePath(realPathDeps());
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
    // Re-measure cells once web fonts finish loading, or glyph spacing can be off.
    void document.fonts?.ready.then(() => this.applyAppearance());
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
    this.addCommand({
      id: "send-selection",
      name: "Send selection to kyle-term",
      editorCallback: (editor) => void this.sendSelection(editor.getSelection()),
    });
    this.addCommand({
      id: "send-note",
      name: "Send note to kyle-term",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f) return false;
        if (!checking) void this.sendNote(f);
        return true;
      },
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        menu.addItem((i) => i.setTitle("Open terminal here").setIcon("terminal").onClick(() => void this.newShell(true, this.folderOf(file))));
        menu.addItem((i) => i.setTitle("New Claude session here").setIcon("bot").onClick(() => void this.newClaude(true, { cwd: this.folderOf(file) })));
        if (file instanceof TFile) {
          menu.addItem((i) => i.setTitle("Send note to kyle-term").setIcon("send").onClick(() => void this.sendNote(file)));
        }
      }),
    );
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, view) => {
        if (editor.getSelection()) {
          menu.addItem((i) => i.setTitle("Send selection to kyle-term").setIcon("send").onClick(() => void this.sendSelection(editor.getSelection())));
        }
        const f = view.file;
        if (f) menu.addItem((i) => i.setTitle("Send note to kyle-term").setIcon("send").onClick(() => void this.sendNote(f)));
      }),
    );
    this.player = new SoundPlayer(this.app);
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("mod-clickable", "kt-status");
    this.statusEl.style.display = "none";
    this.statusEl.onclick = () => void this.jumpToAttention();
    this.addSettingTab(new KyleTermSettingTab(this.app, this));
    this.cleanOrphans(this.savedSessions.map((p) => p.id));
    this.registerInterval(window.setInterval(() => this.saveScrollback(), SCROLLBACK_SAVE_MS));
  }

  override onunload(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = undefined;
    this.flushSync();
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

  /** Obsidian's resolved monospace (code) font list, e.g. from Appearance → Monospace font. */
  private readObsidianMono(): string {
    const probe = document.body.createDiv();
    probe.style.fontFamily = "var(--font-monospace)";
    probe.style.display = "none";
    const f = getComputedStyle(probe).fontFamily;
    probe.remove();
    return f;
  }

  /** xterm draws with canvas `ctx.font`, which silently ignores an invalid font list. */
  private canvasAccepts(family: string): string {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return family;
    ctx.font = "1px __kt_sentinel__";
    ctx.font = `14px ${family}`;
    return ctx.font.startsWith("14px") ? family : DEFAULT_FONT_FAMILY;
  }

  currentPalette(): Palette {
    return resolvePalette(this.settings.appearance, obsidianPalette((v) => this.readCssColor(v)));
  }

  termLook(): TermLook {
    const a = this.settings.appearance;
    return {
      theme: buildXtermTheme(this.currentPalette(), a.terminalOpacity),
      fontFamily: this.canvasAccepts(resolveFontFamily(a.fontFamily, this.readObsidianMono())),
      fontSize: a.fontSize,
      webgl: shouldUseWebgl(a.terminalOpacity),
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
      return Platform.resourcePathPrefix + encodeURI(process.platform === "win32" ? raw.split("\\").join("/") : raw).replace(/#/g, "%23");
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
    return pickProfileId(this.settings.defaultProfile, this.profiles);
  }

  /** Returns the session manager, or an error message string if Node can't be found. */
  getSessions(): SessionManager | string {
    if (this.sessions) return this.sessions;
    const node = resolveNode(this.settings.nodePath, this.resolvedPath ?? undefined);
    if (!node.ok) return node.message ?? "Node.js not found.";
    const dir = this.manifest.dir ?? "";
    const helper = path.join(this.vaultRoot(), dir, "helper", "pty-host.js");
    const pty = new PtyManager(node.path, helper, this.resolvedPath ? { PATH: this.resolvedPath } : undefined);
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
      env: () => ({ ...this.hookEnv, ...(this.resolvedPath ? { PATH: this.resolvedPath } : {}) }),
      idleMs: () => this.settings.idleSeconds * 1000,
      resumeCommand: (id) => `${this.settings.claudeCommand || "claude"} --resume ${id}`,
      cwdExists: (p) => fs.existsSync(p),
      fallbackCwd: () => this.vaultRoot(),
      notify: (m) => new Notice(m, 8000),
      onClosed: (id) => this.deleteScrollback(id),
    });
    this.sessions.onStateChange((s, _prev, next) => {
      if (next === "needs-input" || next === "finished") this.alert(next, s);
    });
    this.sessions.onSubAgentDone((s) => this.alert("sub-agent-done", s));
    this.sessions.onChange(() => this.updateStatusBar());
    const restored = this.savedSessions;
    this.savedSessions = [];
    this.sessions.restore(restored, (id) => this.readScrollback(id));
    this.sessions.onChange(() => this.schedulePersist());
    return this.sessions;
  }

  private hooks(mode: "install" | "uninstall"): void {
    const script = path.join(this.vaultRoot(), this.manifest.dir ?? "", "hooks", "kyle-hook.js");
    const r = applyToFile(path.join(os.homedir(), ".claude", "settings.json"), mode, script);
    new Notice(`kyle-term: ${r.message}`, r.ok ? 6000 : 12000);
  }

  /** Absolute folder for a vault entry; for a note, its parent folder. */
  folderOf(file: TAbstractFile): string {
    const dir = file instanceof TFolder ? file : file.parent;
    return !dir || dir.isRoot() ? this.vaultRoot() : path.join(this.vaultRoot(), dir.path);
  }

  async newShell(reveal = false, cwd?: string): Promise<void> {
    const m = this.getSessions();
    if (typeof m === "string") return void new Notice(m);
    m.create({ kind: "shell", profileId: this.defaultProfileId(), cwd: cwd ?? this.vaultRoot() });
    if (reveal) await this.activateView();
  }

  async newClaude(reveal = false, opts: { cwd?: string; args?: string } = {}): Promise<Session | undefined> {
    const m = this.getSessions();
    if (typeof m === "string") return void new Notice(m);
    const base = this.settings.claudeCommand || "claude";
    const s = m.create({
      kind: "claude",
      profileId: this.defaultProfileId(),
      cwd: opts.cwd || this.settings.claudeStartFolder || this.vaultRoot(),
      command: opts.args ? `${base} ${opts.args}` : base,
    });
    if (reveal) await this.activateView();
    return s;
  }

  /** Right-click menu on the New Session button. */
  showNewSessionMenu(e: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Continue last").setIcon("history").onClick(() => void this.newClaude(true, { args: "--continue" })));
    menu.addItem((i) =>
      i.setTitle("Choose folder…").setIcon("folder-search").onClick(() =>
        new FolderSuggest(this.app, (f) => void this.newClaude(true, { cwd: this.folderOf(f) })).open(),
      ),
    );
    const saved = this.settings.savedFolders.filter((f) => f.path);
    if (saved.length > 0) {
      menu.addSeparator();
      for (const f of saved) {
        menu.addItem((i) => i.setTitle(f.name || f.path).setIcon("folder").onClick(() => void this.newClaude(true, { cwd: f.path })));
      }
      menu.addSeparator();
    }
    menu.addItem((i) => i.setTitle("Manage saved folders…").setIcon("settings").onClick(() => this.openSettings()));
    menu.showAtMouseEvent(e);
  }

  private openSettings(): void {
    // Not in the public typings; guard it.
    const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
    try { setting?.open(); setting?.openTabById(this.manifest.id); } catch { /* ignore */ }
  }

  /** The running session to type into; starts a Claude session (and waits for it) if none. */
  private async targetSession(): Promise<Session | undefined> {
    const m = this.getSessions();
    if (typeof m === "string") return void new Notice(m);
    await this.activateView();
    let s = m.active;
    if (s && s.status === "running") return s;
    s = await this.newClaude(true);
    if (!s) return undefined;
    if (!(await m.whenReady(s.id))) new Notice("kyle-term: Claude was slow to start; sending anyway");
    return m.get(s.id)?.status === "running" ? s : undefined;
  }

  /** Type text into the active session (no Enter), focusing its terminal. */
  async sendText(text: string): Promise<void> {
    if (!text) return;
    const s = await this.targetSession();
    if (s) this.sessions?.sendText(s.id, text);
  }

  async sendSelection(text: string): Promise<void> {
    if (!text) return void new Notice("kyle-term: nothing selected");
    await this.sendText(text);
  }

  async sendNote(file: TFile): Promise<void> {
    const s = await this.targetSession();
    if (!s) return;
    this.sessions?.sendText(s.id, this.refsFor([path.join(this.vaultRoot(), file.path)], s.cwd));
  }

  private refsFor(abs: string[], cwd: string): string {
    return buildRefs(abs, cwd, this.settings.pathMode);
  }

  /** Turn a drop into text to type: `@path` refs for explorer drags, else the dropped text. */
  resolveDrop(dt: DataTransfer | null, cwd: string): string | null {
    const abs = (f: TAbstractFile) => (f.path === "/" ? this.vaultRoot() : path.join(this.vaultRoot(), f.path));
    try {
      // Obsidian's explorer drag uses a private drag manager; guard everything.
      const d = (this.app as unknown as { dragManager?: { draggable?: { type?: string; file?: TAbstractFile; files?: TAbstractFile[] } } }).dragManager?.draggable;
      if (d) {
        const files = d.type === "files" ? d.files : d.file ? [d.file] : [];
        const ok = (files ?? []).filter((f): f is TAbstractFile => !!f && typeof f.path === "string");
        if (ok.length > 0) return this.refsFor(ok.map(abs), cwd);
      }
    } catch { /* fall through to text */ }
    const text = dt?.getData("text/plain") ?? "";
    if (!text) return null;
    const parsed = parseDropText(text, this.app.vault.getName());
    if (parsed.kind === "text") return parsed.text;
    const found: string[] = [];
    for (const p of parsed.paths) {
      const f = this.app.vault.getAbstractFileByPath(p) ?? this.app.metadataCache.getFirstLinkpathDest(p, "");
      if (!f) return text;
      found.push(abs(f));
    }
    return this.refsFor(found, cwd);
  }

  async loadSettings(): Promise<void> {
    const raw = (await this.loadData()) as (Partial<KyleTermSettings> & { sessions?: unknown; version?: unknown }) | null;
    const { sessions: savedSessions, version: _v, ...saved } = raw ?? {};
    void _v;
    this.savedSessions = parsePersisted(savedSessions);
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved, { savedFolders: (saved?.savedFolders ?? []).map((f) => ({ ...f })), sounds: mergeSounds(saved?.sounds), appearance: mergeAppearance(saved?.appearance) });
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.dataBlob());
  }

  /** Settings plus session metadata, as stored in data.json. */
  private dataBlob(): Record<string, unknown> {
    return { ...this.settings, version: PERSIST_VERSION, sessions: this.sessions ? this.sessions.snapshot() : this.savedSessions };
  }

  private pluginDir(): string { return path.join(this.vaultRoot(), this.manifest.dir ?? ""); }
  private sessionsDir(): string { return path.join(this.pluginDir(), "sessions"); }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => { this.persistTimer = undefined; void this.saveSettings(); }, PERSIST_DEBOUNCE_MS);
  }

  private readScrollback(id: string): string | undefined {
    if (!this.settings.restoreScrollback) return undefined;
    try { return fs.readFileSync(path.join(this.sessionsDir(), scrollbackFile(id)), "utf8"); } catch { return undefined; }
  }

  private deleteScrollback(id: string): void {
    try { fs.rmSync(path.join(this.sessionsDir(), scrollbackFile(id)), { force: true }); } catch { /* ignore */ }
  }

  /** Delete scrollback files that belong to no known session. */
  private cleanOrphans(keepIds: string[]): void {
    try {
      const dir = this.sessionsDir();
      if (!fs.existsSync(dir)) return;
      const keep = this.settings.restoreScrollback ? keepIds : [];
      for (const f of orphanFiles(fs.readdirSync(dir), keep)) fs.rmSync(path.join(dir, f), { force: true });
    } catch (e) {
      console.error("[kyle-term] orphan cleanup failed", e);
    }
  }

  /** Write scrollback for sessions whose output changed (sync, so it also works during unload). */
  private saveScrollback(force = false): void {
    const m = this.sessions;
    if (!m || !this.settings.restoreScrollback) return;
    try {
      const dir = this.sessionsDir();
      fs.mkdirSync(dir, { recursive: true });
      for (const s of m.list()) {
        const text = m.takeScrollback(s.id, this.settings.scrollbackLines, force);
        if (text !== undefined) fs.writeFileSync(path.join(dir, scrollbackFile(s.id)), text);
      }
    } catch (e) {
      console.error("[kyle-term] saving scrollback failed", e);
    }
  }

  /** Final synchronous save for onunload: scrollback files and data.json. */
  private flushSync(): void {
    if (!this.sessions) return;
    this.saveScrollback();
    try {
      fs.writeFileSync(path.join(this.pluginDir(), "data.json"), JSON.stringify(this.dataBlob(), null, 2));
    } catch (e) {
      console.error("[kyle-term] saving session data failed", e);
    }
  }

  setRestoreScrollback(v: boolean): void {
    this.settings.restoreScrollback = v;
    if (v) this.saveScrollback(true);
    else this.cleanOrphans([]);
    void this.saveSettings();
  }
}
