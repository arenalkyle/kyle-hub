import { FileSystemAdapter, Menu, Notice, Platform, TFile, TFolder, type TAbstractFile } from "obsidian";
import type { AttentionService, Hub, LaunchService, ModuleContext, SessionService, SessionState, TicketService } from "../../../core";
import { FolderSuggest } from "./folder-suggest";
import { buildRefs, parseDropText } from "./vault-paths";
import path from "node:path";
import os from "node:os";
import { loadSettingsFile, planHookInstall, planHookUninstall, writeSettingsFile } from "./hook-installer";
import { HookDiffModal } from "./hook-diff-modal";
import { createSessionService, wireSessionEvents } from "./service";
import { HookServer } from "./hook-server";
import { adaptRestored, chooseProfileId, isWslUncPath, wslAdapterAddress, wslProfile } from "./wsl";
import { forwardHookToLogs } from "./hook-logs";
import xtermCss from "@xterm/xterm/css/xterm.css";
import { PtyManager } from "./pty-manager";
import { resolveNode } from "./node-path";
import { TermSettingsSection } from "./settings";
import { normalizeTerm, type TermData } from "./schema";
import { decideAlert, nextAttention, sessionKey, type AlertEvent } from "./alert";
import { SoundPlayer } from "./sound";
import { TermView, VIEW_TYPE } from "./view";
import { SessionManager, type Session } from "./session-manager";
import { detectProfiles, pickProfileId, type ShellProfile } from "./shells";
import { XtermSession, type TermLook } from "./xterm-session";
import {
  blurPx, buildXtermTheme, DEFAULT_FONT_FAMILY, resolveFontFamily, obsidianPalette, resolvePalette, shouldUseWebgl, toHex, type Palette,
} from "./appearance";
import fs from "node:fs";
import { orphanFiles, scrollbackFile } from "./persist";
import { dataDir } from "../../../core/paths";
import { vaultProfileOf } from "../../../core/profile";
import type { RepoConfig } from "../../../core/domain/fields";
import { accountsOf } from "../../../core/accounts";
import { AccountPicker } from "../queue/AccountPicker";
import { Launcher, type LaunchSettings } from "../launch/launch";
import { realFs, realGit, realPrMerged } from "../launch/git";
import { AttentionTracker, StallDetector } from "../run/attention";
import { RunRegistry } from "../run/runs";
import { RunWatcher } from "../run/watcher";
import { finishRun } from "../run/sessionEnd";
import { offerWorktreeCleanup } from "../run/cleanup";
import { categoryOf } from "../../../core/domain/fields";
import { offerNotice } from "../run/offerNotice";
import { RepoPicker } from "../queue/RepoPicker";
import { claudeRunner } from "../retro/llm";
import { createRetroService } from "../retro/service";
import type { RetroService } from "../../../core";

const PERSIST_DEBOUNCE_MS = 2000;
const SCROLLBACK_SAVE_MS = 30_000;

/** Folder name of the deployed plugin (`.obsidian/plugins/<id>`); the hook script and helper live there. */
const PLUGIN_ID = "kyle-hub";

/** The terminal module's runtime: everything kyle-term's plugin class did, on top of the hub's context. */
export default class TermHost {
  readonly app: Hub["app"];
  /** The live `modules.term` object (shared with the hub's data.json). */
  settings: TermData;
  profiles: ShellProfile[] = [];
  nodeInfo = "";
  private pty: PtyManager | null = null;
  private sessions: SessionManager | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private hookServer: HookServer | null = null;
  private hookEnv: Record<string, string> = {};
  private wslPending = false;
  private player: SoundPlayer | null = null;
  private statusEl: HTMLElement | null = null;
  private xterms = new Set<XtermSession>();
  private savedSessions: TermData["sessions"] = [];
  private unwire: (() => void) | null = null;
  private stateListeners = new Set<(s: Session, prev: SessionState) => void>();
  private persistTimer?: ReturnType<typeof setTimeout>;
  private muteListeners = new Set<() => void>();
  private lastPlayed: { bySession: Record<string, number>; byEvent: Partial<Record<AlertEvent, number>> } = { bySession: {}, byEvent: {} };

  constructor(readonly hub: Hub, private ctx: ModuleContext) {
    this.app = hub.app;
    this.settings = ctx.settings.get<TermData>();
    normalizeTerm(this.settings);
  }

  /** Registers everything with the module context; `stop()` undoes what the context does not. */
  async start(): Promise<SessionService> {
    // Vault on the WSL share: offer "WSL (<distro>)" first; folders on the share open in it (see chooseProfileId).
    const wsl = process.platform === "win32" ? wslProfile(this.vaultRoot()) : null;
    this.profiles = wsl ? [wsl, ...detectProfiles()] : detectProfiles();
    this.savedSessions = adaptRestored(this.settings.sessions, this.vaultRoot());
    this.styleEl = document.head.createEl("style", { text: xtermCss });
    const server = new HookServer((m) => {
      this.sessions?.handleHook(m.session, m.event, m.payload);
      this.watcher?.onHook(m.session, m.event, m.payload, m.env);
      forwardHookToLogs(this.hub.services, m, { vaultRoot: this.vaultRoot(), emitAccess: (e) => this.hub.events.emit("brain:access", e),
        emitSubagent: (e) => (e.kind === "started" ? this.hub.events.emit("subagent:started", { sessionId: e.sessionId, agentId: e.agentId, ...(e.agentType ? { agentType: e.agentType } : {}) }) : this.hub.events.emit("subagent:ended", { sessionId: e.sessionId, agentId: e.agentId })) });
    });
    try {
      await server.start();
      this.hookServer = server;
      this.hookEnv = { KYLE_TERM_PORT: String(server.port), KYLE_TERM_TOKEN: server.token };
      this.ensureWslListener();
    } catch (e) {
      console.error("[kyle-hub] terminal hook server failed to start", e);
    }
    this.ctx.registerEvent(this.app.workspace.on("css-change", () => this.applyAppearance()));
    // Re-measure cells once web fonts finish loading, or glyph spacing can be off.
    void document.fonts?.ready.then(() => this.applyAppearance());
    this.ctx.registerView(VIEW_TYPE, (leaf) => new TermView(leaf, this));
    this.ctx.addRibbonIcon("terminal", "Open terminal", () => void this.activateView());
    this.ctx.addNavItem({ id: "terminal", label: "Terminal", icon: "terminal", viewType: VIEW_TYPE, order: 20, open: () => void this.activateView() });
    this.ctx.addCommand({ id: "term-open", name: "Open terminal", callback: () => void this.activateView() });
    this.ctx.addCommand({
      id: "term-new-terminal",
      name: "New terminal",
      hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "T" }],
      callback: () => void this.newShell(true),
    });
    this.ctx.addCommand({ id: "term-new-claude-session", name: "New Claude session", callback: () => void this.newClaude(true) });
    this.ctx.addCommand({
      id: "term-next-session",
      name: "Next session",
      hotkeys: [{ modifiers: ["Ctrl"], key: "Tab" }],
      callback: () => this.sessions?.next(),
    });
    this.ctx.addCommand({
      id: "term-previous-session",
      name: "Previous session",
      hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "Tab" }],
      callback: () => this.sessions?.prev(),
    });
    this.ctx.addCommand({ id: "term-install-hooks", name: "Install hooks", callback: () => this.hooks("install") });
    this.ctx.addCommand({ id: "term-uninstall-hooks", name: "Uninstall hooks", callback: () => this.hooks("uninstall") });
    this.ctx.addCommand({
      id: "term-jump-next-attention",
      name: "Jump to next session needing attention",
      hotkeys: [{ modifiers: ["Alt"], key: "a" }],
      callback: () => void this.jumpToAttention(),
    });
    this.ctx.addCommand({ id: "term-toggle-mute", name: "Toggle mute", callback: () => this.setMuted(!this.settings.sounds.muted) });
    this.ctx.addCommand({
      id: "term-send-selection",
      name: "Send selection to terminal",
      editorCallback: (editor) => void this.sendSelection(editor.getSelection()),
    });
    this.ctx.addCommand({
      id: "term-send-note",
      name: "Send note to terminal",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f) return false;
        if (!checking) void this.sendNote(f);
        return true;
      },
    });
    this.ctx.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        menu.addItem((i) => i.setTitle("Open terminal here").setIcon("terminal").onClick(() => void this.newShell(true, this.folderOf(file))));
        menu.addItem((i) => i.setTitle("New Claude session here").setIcon("bot").onClick(() => void this.newClaude(true, { cwd: this.folderOf(file) })));
        if (file instanceof TFile) {
          menu.addItem((i) => i.setTitle("Send note to terminal").setIcon("send").onClick(() => void this.sendNote(file)));
        }
      }),
    );
    this.ctx.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, view) => {
        if (editor.getSelection()) {
          menu.addItem((i) => i.setTitle("Send selection to terminal").setIcon("send").onClick(() => void this.sendSelection(editor.getSelection())));
        }
        const f = view.file;
        if (f) menu.addItem((i) => i.setTitle("Send note to terminal").setIcon("send").onClick(() => void this.sendNote(f)));
      }),
    );
    this.player = new SoundPlayer(this.app);
    this.statusEl = this.ctx.addStatusBarItem();
    this.statusEl.addClass("mod-clickable", "kh-term-status");
    this.statusEl.style.display = "none";
    this.statusEl.onclick = () => void this.jumpToAttention();
    this.ctx.addSettingsSection(new TermSettingsSection(this));
    this.cleanOrphans(this.savedSessions.map((p) => p.id));
    this.ctx.registerInterval(window.setInterval(() => this.saveScrollback(), SCROLLBACK_SAVE_MS));
    this.initRuns();
    this.ctx.registerInterval(window.setInterval(() => this.watcher?.tick(), 5000));
    return createSessionService(this, (cb) => {
      this.stateListeners.add(cb);
      return () => this.stateListeners.delete(cb);
    });
  }

  stop(): void {
    this.watcher = null;
    this.retroSvc = undefined;
    this.offBus.forEach((o) => o());
    this.offBus = [];
    this.unwire?.();
    this.unwire = null;
    this.stateListeners.clear();
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
      return Platform.resourcePathPrefix + encodeURI(raw.split("\\").join("/")).replace(/#/g, "%23");
    } catch {
      if (notify) new Notice(`kyle-hub: background image not found or unreadable: ${raw.replace(/^vault:/, "")}`);
      return null;
    }
  }

  /** CSS custom properties for the background layers. */
  bgVars(notify = false): Record<string, string> {
    const a = this.settings.appearance;
    const url = this.bgUrl(notify);
    return {
      "--kh-term-bg": toHex(this.currentPalette().background),
      "--kh-term-img": url ? `url("${url}")` : "none",
      "--kh-term-img-opacity": String(a.imageOpacity / 100),
      "--kh-term-img-blur": `${blurPx(a.imageBlur)}px`,
      "--kh-term-img-dim": String(a.imageDim / 100),
    };
  }

  /** Re-apply theme, font and background to every open terminal and view. Live, no re-creation. */
  applyAppearance(notify = false): void {
    for (const t of this.xterms) t.applyLook();
    const vars = this.bgVars(notify);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      (leaf.view as TermView).applyBackground?.(vars);
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

  /** Obsidian focused and this session's tile on screen in some terminal view. */
  private isViewing(s: Session): boolean {
    if (!document.hasFocus()) return false;
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).some((l) => l.view instanceof TermView && l.view.shows(s.id));
  }

  private alert(event: AlertEvent, s: Session): void {
    const now = Date.now();
    const d = decideAlert({
      event, sessionId: s.id, now, sounds: this.settings.sounds,
      viewing: this.isViewing(s), fromClaude: s.agent.hasHookEvents, lastPlayed: this.lastPlayed,
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
    if (!id) return void new Notice("kyle-hub: no session needs attention");
    await this.activateView();
    m.setActive(id);
  }

  private launcherInst: Launcher | null = null;
  private readonly registry = new RunRegistry();
  private readonly tracker = new AttentionTracker((e, p) => this.hub.events.emit(e, p));
  private readonly stall = new StallDetector(() => Date.now(), () => this.settings.idleSeconds * 1000);
  private watcher: RunWatcher | null = null;
  private offBus: (() => void)[] = [];

  /** Ticket service resolved per call (the tickets module may be off or reloaded). */
  private ticketsProxy(): TicketService {
    return new Proxy({} as TicketService, {
      get: (_t, k) => {
        const t = this.hub.services.get("tickets");
        if (!t) throw new Error("Tickets module disabled.");
        return (t as unknown as Record<string | symbol, unknown>)[k];
      },
    });
  }

  private retroSvc: RetroService | undefined;

  /** The retro loop (Perform Retro, Apply, Draft rule). Tickets and logs are read per call (modules may be off). */
  retroService(): RetroService {
    return (this.retroSvc ??= createRetroService({
      tickets: () => this.hub.services.get("tickets"),
      logs: () => this.hub.services.get("logs"),
      rawSettings: () => (this.hub.settings.module("term") as Record<string, unknown>).retro,
      repos: () => (this.hub.settings.module("core").repos as Record<string, { path?: string; profile?: string }> | undefined) ?? {},
      ctx: {
        claudeHome: path.join(os.homedir(), ".claude"),
        repoPath: (key) => (key === undefined ? undefined : (this.hub.settings.module("core").repos as Record<string, { path?: string }> | undefined)?.[key]?.path),
        readFile: (p) => {
          try {
            return fs.readFileSync(p, "utf8");
          } catch {
            return undefined;
          }
        },
      },
      runner: () => claudeRunner(this.settings.claudeCommand || "claude"),
      vaultProfile: () => vaultProfileOf(this.hub.settings.module("core")),
      vaultRoot: () => this.vaultRoot(),
    }));
  }

  /** What other modules read to show needs-attention badges. */
  attentionService(): AttentionService {
    return this.tracker.service(
      (id) => this.focusSession(id),
      () => this.registry.list().map((r) => ({ ticketId: r.ticketId, runId: r.runId, ...(r.accountId ? { accountId: r.accountId } : {}) })),
    );
  }

  /** End-of-run handling and the worktree cleanup offer (LOCK-52). */
  private initRuns(): void {
    this.watcher = new RunWatcher({
      registry: this.registry,
      tracker: this.tracker,
      stall: this.stall,
      finish: (run, end) =>
        finishRun({ tickets: this.ticketsProxy(), logs: this.hub.services.get("logs"), git: realGit, clock: () => new Date() }, run, end),
      emit: (e, p) => this.hub.events.emit(e, p),
    });
    this.offBus.push(
      this.hub.events.on("ticket:status-changed", ({ id, to }) => {
        this.watcher?.onTicketStatusChanged(id);
        const tickets = this.hub.services.get("tickets");
        if (tickets && categoryOf(to, tickets.statuses()) === "completed") void this.cleanupOffer(id);
      }),
    );
  }

  private async cleanupOffer(id: string): Promise<void> {
    try {
      const r = await offerWorktreeCleanup(
        {
          git: realGit,
          fs: realFs,
          tickets: this.ticketsProxy(),
          repos: () => (this.hub.settings.module("core").repos as Record<string, RepoConfig> | undefined) ?? {},
          prMerged: realPrMerged,
          offer: (message) => offerNotice(message),
          join: path.join,
          dirname: path.dirname,
        },
        id,
      );
      if (r.kind === "removed") new Notice(`kyle-hub: removed worktree for ${id}${r.branchDeleted ? " and its branch" : ""}.`);
      else if (r.kind === "failed") new Notice(`kyle-hub: ${r.message}`, 10000);
    } catch (e) {
      console.error("kyle-hub: worktree cleanup offer failed", e);
    }
  }

  /** Core-facing wrapper so other modules (the ticket queue) can launch without importing term. */
  launchService(): LaunchService {
    return {
      launch: async (id, opts) => {
        const l = this.launcher();
        if (!l) return { ok: false, message: "Terminal sessions are unavailable." };
        const r = await l.launch(id, opts);
        return r.ok ? { ok: true, sessionId: r.sessionId } : { ok: false, message: r.message };
      },
      runningTickets: () => this.launcher()?.runningTickets() ?? new Map<string, string>(),
    };
  }

  /** The launch orchestrator; null while the sessions service is unavailable. Tickets are read per call (module may be off). */
  launcher(): Launcher | null {
    const sessions = this.hub.services.get("sessions");
    if (!sessions) return null;
    return (this.launcherInst ??= new Launcher({
      git: realGit,
      fs: realFs,
      sessions,
      tickets: this.ticketsProxy(),
      clock: () => new Date(),
      repos: () => (this.hub.settings.module("core").repos as Record<string, RepoConfig> | undefined) ?? {},
      settings: (): LaunchSettings => {
        const l = (this.hub.settings.module("core").launch ?? {}) as Partial<LaunchSettings>;
        return {
          maxConcurrentRuns: typeof l.maxConcurrentRuns === "number" && l.maxConcurrentRuns >= 1 ? Math.floor(l.maxConcurrentRuns) : 3,
          defaultModel: l.defaultModel ?? "sonnet",
          claudeCommand: this.settings.claudeCommand || "claude",
        };
      },
      packDir: (profile) => path.join(dataDir(profile), "packs"),
      vaultProfile: () => vaultProfileOf(this.hub.settings.module("core")),
      brain: () => this.hub.services.get("brain"),
      accounts: () => accountsOf(this.hub.settings.module("core")),
      pickAccount: async (list, pre) => {
        const lines = await this.hub.services.get("usage")?.lines().catch(() => ({}));
        return new Promise((resolve) => new AccountPicker(this.app, list, pre, resolve, lines ?? {}).open());
      },
      pickRepo: (keys) => new Promise((resolve) => new RepoPicker(this.app, keys, resolve).open()),
      onRun: (r) => this.registry.register(r),
      join: path.join,
      dirname: path.dirname,
    }));
  }

  async focusSession(id: string): Promise<void> {
    await this.hub.services.get("sessions")?.focus(id);
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

  /**
   * Vault on the WSL share (Claude runs in WSL2): also listen on the `vEthernet (WSL)` address and pass it as
   * `KYLE_TERM_WSL_HOST`, which kyle-hook.js tries when 127.0.0.1 fails (NAT networking). Retried on each spawn,
   * since the adapter only exists once WSL has started. Windows Firewall must allow Obsidian on that adapter.
   */
  private ensureWslListener(): void {
    const server = this.hookServer;
    if (!server || this.wslPending || process.platform !== "win32" || this.hookEnv.KYLE_TERM_WSL_HOST || !isWslUncPath(this.vaultRoot())) return;
    const host = wslAdapterAddress(os.networkInterfaces());
    if (!host) return;
    this.wslPending = true;
    server.listenOn(host).then(
      (port) => { this.hookEnv.KYLE_TERM_WSL_HOST = `${host}:${port}`; },
      (e) => console.error("[kyle-hub] WSL hook listener failed", e),
    ).finally(() => { this.wslPending = false; });
  }

  vaultRoot(): string {
    const a = this.app.vault.adapter;
    return a instanceof FileSystemAdapter ? a.getBasePath() : process.cwd();
  }

  /** Profile for a session in `cwd`: WSL for a folder on the WSL share, else the saved default. */
  profileFor(cwd: string): string {
    return chooseProfileId(cwd, pickProfileId(this.settings.defaultProfile, this.profiles), this.profiles);
  }

  /** Returns the session manager, or an error message string if Node can't be found. */
  getSessions(): SessionManager | string {
    if (this.sessions) return this.sessions;
    const node = resolveNode(this.settings.nodePath);
    if (!node.ok) return node.message ?? "Node.js not found.";
    const helper = path.join(this.pluginDir(), "helper", "pty-host.js");
    const pty = new PtyManager(node.path, helper);
    pty.onError = (msg) => console.error("[kyle-hub]", msg);
    this.pty = pty;
    this.sessions = new SessionManager({
      pty,
      makeTerm: (h) => {
        const t = new XtermSession(h, () => this.termLook(), (x) => this.xterms.delete(x));
        this.xterms.add(t);
        return t;
      },
      profiles: () => this.profiles,
      env: () => { this.ensureWslListener(); return { ...this.hookEnv }; },
      idleMs: () => this.settings.idleSeconds * 1000,
      resumeCommand: (id) => `${this.settings.claudeCommand || "claude"} --resume ${id}`,
      cwdExists: (p) => fs.existsSync(p),
      fallbackCwd: () => this.vaultRoot(),
      notify: (m) => new Notice(m, 8000),
      onClosed: (id) => this.deleteScrollback(id),
    });
    this.sessions.onStateChange((s, prev, next) => {
      this.watcher?.onState(s.id, next);
      if (next === "needs-input" || next === "finished") this.alert(next, s);
      for (const l of [...this.stateListeners]) l(s, prev);
    });
    this.unwire = wireSessionEvents(this.sessions, this.hub.events, (id) => this.registry.get(id) !== undefined);
    this.offBus.push(this.sessions.onLifecycle((kind, s) => { if (kind === "ended") this.watcher?.onExit(s.id, s.exitCode); }));
    this.sessions.onSubAgentDone((s) => this.alert("sub-agent-done", s));
    this.sessions.onChange(() => this.updateStatusBar());
    const restored = this.savedSessions;
    this.savedSessions = [];
    this.sessions.restore(restored, (id) => this.readScrollback(id));
    this.sessions.onChange(() => this.schedulePersist());
    return this.sessions;
  }

  /**
   * Install writes `<vault>/.claude/settings.local.json`, then removes our entries from `~/.claude/settings.json`;
   * uninstall removes from both. Steps run one after another, each diff shown in a modal and written only on accept;
   * a cancelled or failed step stops the chain, so the global entries are never removed before the vault install lands.
   */
  private hooks(mode: "install" | "uninstall"): void {
    const vaultFile = path.join(this.vaultRoot(), ".claude", "settings.local.json");
    const globalFile = path.join(os.homedir(), ".claude", "settings.json");
    const vault = { file: vaultFile, label: "vault .claude/settings.local.json" };
    const global = { file: globalFile, label: "global ~/.claude/settings.json" };
    const steps: Array<{ file: string; label: string; mode: "install" | "uninstall" }> = mode === "install"
      ? [{ ...vault, mode: "install" }, { ...global, mode: "uninstall" }]
      : [{ ...vault, mode: "uninstall" }, { ...global, mode: "uninstall" }];
    let changedAny = false;
    const run = (i: number): void => {
      const step = steps[i];
      if (!step) {
        if (!changedAny) new Notice(`kyle-hub: ${mode === "install" ? "Hooks already installed in the vault; none in global settings." : "No kyle-hub or kyle-term hooks found."}`, 6000);
        return;
      }
      const loaded = loadSettingsFile(step.file);
      if (!loaded.ok) return void new Notice(`kyle-hub: ${loaded.message}`, 12000);
      const plan = step.mode === "install" ? planHookInstall(loaded.current, this.hookScriptRel()) : planHookUninstall(loaded.current);
      if (!plan.changed) return run(i + 1);
      changedAny = true;
      const before = loaded.raw === null ? "" : JSON.stringify(loaded.current, null, 2);
      const after = JSON.stringify(plan.next, null, 2);
      new HookDiffModal(this.app, { mode: step.mode, file: step.file, label: step.label, before, after }, () => {
        const r = writeSettingsFile(step.file, loaded.raw, plan.next, step.mode);
        new Notice(`kyle-hub (${step.label}): ${r.message}`, r.ok ? 6000 : 12000);
        if (r.ok) run(i + 1);
      }).open();
    };
    run(0);
  }

  /** The deployed hook script relative to the vault (`.obsidian/plugins/kyle-hub/hooks/kyle-hook.js`), forward slashes. */
  hookScriptRel(): string {
    return [this.app.vault.configDir, "plugins", PLUGIN_ID, "hooks", "kyle-hook.js"].join("/");
  }

  /** Absolute folder for a vault entry; for a note, its parent folder. */
  folderOf(file: TAbstractFile): string {
    const dir = file instanceof TFolder ? file : file.parent;
    return !dir || dir.isRoot() ? this.vaultRoot() : path.join(this.vaultRoot(), dir.path);
  }

  async newShell(reveal = false, cwd?: string): Promise<void> {
    const m = this.getSessions();
    if (typeof m === "string") return void new Notice(m);
    const dir = cwd ?? this.vaultRoot();
    m.create({ kind: "shell", profileId: this.profileFor(dir), cwd: dir });
    if (reveal) await this.activateView();
  }

  async newClaude(reveal = false, opts: { cwd?: string; args?: string } = {}): Promise<Session | undefined> {
    const m = this.getSessions();
    if (typeof m === "string") return void new Notice(m);
    const base = this.settings.claudeCommand || "claude";
    const cwd = opts.cwd || this.settings.claudeStartFolder || this.vaultRoot();
    const s = m.create({
      kind: "claude",
      profileId: this.profileFor(cwd),
      cwd,
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
    try { setting?.open(); setting?.openTabById(PLUGIN_ID); } catch { /* ignore */ }
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
    if (!(await m.whenReady(s.id))) new Notice("kyle-hub: Claude was slow to start; sending anyway");
    return m.get(s.id)?.status === "running" ? s : undefined;
  }

  /** Type text into the active session (no Enter), focusing its terminal. */
  async sendText(text: string): Promise<void> {
    if (!text) return;
    const s = await this.targetSession();
    if (s) this.sessions?.sendText(s.id, text);
  }

  async sendSelection(text: string): Promise<void> {
    if (!text) return void new Notice("kyle-hub: nothing selected");
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

  /** Persists the hub's data.json (the `modules.term` object is this.settings). */
  async saveSettings(): Promise<void> {
    this.syncSessions();
    await this.hub.save();
  }

  /** Session metadata rides along in `modules.term.sessions`. */
  private syncSessions(): void {
    if (this.sessions) this.settings.sessions = this.sessions.snapshot();
  }

  private pluginDir(): string { return path.join(this.vaultRoot(), this.app.vault.configDir, "plugins", PLUGIN_ID); }
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
      console.error("[kyle-hub] terminal orphan cleanup failed", e);
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
      console.error("[kyle-hub] saving terminal scrollback failed", e);
    }
  }

  /** Final synchronous save for onunload: scrollback files and data.json. */
  private flushSync(): void {
    if (!this.sessions) return;
    this.saveScrollback();
    try {
      this.syncSessions();
      fs.writeFileSync(path.join(this.pluginDir(), "data.json"), JSON.stringify(this.hub.settings.all, null, 2));
    } catch (e) {
      console.error("[kyle-hub] saving terminal session data failed", e);
    }
  }

  setRestoreScrollback(v: boolean): void {
    this.settings.restoreScrollback = v;
    if (v) this.saveScrollback(true);
    else this.cleanOrphans([]);
    void this.saveSettings();
  }
}
