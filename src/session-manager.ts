import type { ShellProfile } from "./shells";
import { resolveTitle } from "./title";
import { initialAgent, reduceAgent, SUBAGENT_FADE_MS, type AgentEvent, type AgentInfo, type AgentState } from "./agent-state";
import { dimScrollback, dividerLine, serializeSessions, type PersistedSession } from "./persist";
import type { SessionListener, SpawnOptions } from "./pty-manager";

export type SessionKind = "claude" | "shell";

export interface Session {
  id: string;
  kind: SessionKind;
  profileId: string;
  cwd: string;
  command?: string;
  manualTitle?: string;
  oscTitle?: string;
  color?: string;
  status: "running" | "exited" | "stopped";
  exitCode?: number;
  lastOutputAt: number;
  agent: AgentInfo;
}

export interface PtyLike {
  spawnSession(opts: SpawnOptions, listener: SessionListener): string;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  kill(id: string): void;
}

export interface TermHandlers {
  onInput(data: string): void;
  onResize(cols: number, rows: number): void;
  onTitle(title: string): void;
  onBell(): void;
}

export interface TermLike {
  cols: number;
  rows: number;
  write(data: string): void;
  /** Type text as user input (bracketed paste when the program enabled it). Never presses Enter. */
  paste(text: string): void;
  reset(): void;
  dispose(): void;
  attach(parent: HTMLElement): void;
  fit(): void;
  focus(): void;
  /** Serialised buffer (last `lines` lines, with escape codes), if supported. */
  serialize?(lines: number): string;
}

export type TermFactory = (handlers: TermHandlers) => TermLike;

export interface SessionManagerDeps {
  pty: PtyLike;
  makeTerm: TermFactory;
  profiles: () => ShellProfile[];
  now?: () => number;
  uuid?: () => string;
  /** Extra env for each PTY (hook server port/token); session id is added automatically. */
  env?: () => Record<string, string>;
  /** Quiet period before a never-hooked session is treated as finished. */
  idleMs?: () => number;
  /** Command that resumes a Claude conversation. */
  resumeCommand?: (claudeSessionId: string) => string;
  /** Folder fallback when a restored session's cwd is gone. */
  cwdExists?: (cwd: string) => boolean;
  fallbackCwd?: () => string;
  notify?: (msg: string) => void;
  onClosed?: (id: string) => void;
}

export interface CreateOptions {
  kind: SessionKind;
  profileId: string;
  cwd: string;
  command?: string;
}

interface Runtime {
  term: TermLike;
  ptyId: string | null;
  gen: number;
  cmdSent: boolean;
  cmdSentAt: number;
  /** Output arrived since scrollback was last saved. */
  dirty: boolean;
  /** Command typed for the current start only (a resume); s.command stays the original. */
  command?: string;
  inputSeen: boolean;
  idleTimer?: ReturnType<typeof setTimeout>;
  quietTimer?: ReturnType<typeof setTimeout>;
  fallbackTimer?: ReturnType<typeof setTimeout>;
}

const QUIET_MS = 400;
const FALLBACK_MS = 5000;
const ACTIVITY_THROTTLE_MS = 300;
const TITLE_MAX = 60;

export type StateListener = (s: Session, prev: AgentState, next: AgentState) => void;

/** Plugin-owned session state; sessions (and their terminals) outlive any view. */
export class SessionManager {
  private sessions: Session[] = [];
  private rt = new Map<string, Runtime>();
  private listeners = new Set<() => void>();
  private stateListeners = new Set<StateListener>();
  private subDoneListeners = new Set<(s: Session) => void>();
  private soon?: ReturnType<typeof setTimeout>;
  private fade?: ReturnType<typeof setTimeout>;
  private activeId: string | null = null;
  private now: () => number;
  private uuid: () => string;
  private seq = 0;

  constructor(private deps: SessionManagerDeps) {
    this.now = deps.now ?? Date.now;
    this.uuid = deps.uuid ?? (() => globalThis.crypto.randomUUID());
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private emit(): void { for (const l of this.listeners) l(); }

  /** Phase 4 hook point: fires whenever a session's agent state changes. */
  onStateChange(cb: StateListener): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  /** Fires when a sub-agent of a session goes from running to done. */
  onSubAgentDone(cb: (s: Session) => void): () => void {
    this.subDoneListeners.add(cb);
    return () => this.subDoneListeners.delete(cb);
  }

  private emitSoon(): void {
    if (this.soon) return;
    this.soon = setTimeout(() => { this.soon = undefined; this.emit(); }, ACTIVITY_THROTTLE_MS);
  }

  private dispatch(s: Session, ev: AgentEvent): void {
    const prev = s.agent;
    const next = reduceAgent(prev, ev);
    if (next === prev) return;
    s.agent = next;
    if (next.state !== prev.state) {
      for (const l of this.stateListeners) l(s, prev.state, next.state);
    }
    if (next.subAgents !== prev.subAgents) {
      const was = new Set(prev.subAgents.filter((a) => a.status === "running").map((a) => a.id));
      if (next.subAgents.some((a) => a.status === "done" && was.has(a.id))) {
        for (const l of this.subDoneListeners) l(s);
      }
    }
    const onlyActivity =
      next.state === prev.state && next.subAgents === prev.subAgents && next.firstPrompt === prev.firstPrompt &&
      next.claudeSessionId === prev.claudeSessionId && next.hasHookEvents === prev.hasHookEvents;
    if (onlyActivity) this.emitSoon(); else this.emit();
    if (next.subAgents.some((a) => a.status === "done")) {
      if (this.fade) clearTimeout(this.fade);
      this.fade = setTimeout(() => { this.fade = undefined; this.emit(); }, SUBAGENT_FADE_MS + 100);
    }
  }

  /** Entry point for events posted by hooks/kyle-hook.js. */
  handleHook(sessionId: string, event: string, payload: Record<string, unknown>): void {
    const s = this.get(sessionId);
    if (!s) return;
    this.dispatch(s, { type: "hook", event, payload, at: this.now() });
  }

  /** Paste text into a running session's terminal. Returns false if it can't. */
  sendText(id: string, text: string): boolean {
    const s = this.get(id);
    const rt = this.rt.get(id);
    if (!s || !rt || s.status !== "running" || !text) return false;
    rt.term.paste(text);
    rt.term.focus();
    return true;
  }

  /**
   * Resolves true when a Claude session looks ready for input: a hook event arrived
   * (SessionStart), or the command was typed and output has been quiet for `quietMs`.
   * Resolves false on timeout or if the session exits.
   */
  whenReady(id: string, quietMs = 1500, timeoutMs = 15_000, pollMs = 100): Promise<boolean> {
    const started = this.now();
    return new Promise((resolve) => {
      const tick = (): void => {
        const s = this.get(id);
        const rt = this.rt.get(id);
        if (!s || !rt || s.status !== "running") return resolve(false);
        const t = this.now();
        if (s.agent.hasHookEvents) return resolve(true);
        if (rt.cmdSent && rt.cmdSentAt > 0 && t - Math.max(s.lastOutputAt, rt.cmdSentAt) >= quietMs) return resolve(true);
        if (t - started >= timeoutMs) return resolve(false);
        setTimeout(tick, pollMs);
      };
      tick();
    });
  }

  list(): readonly Session[] { return this.sessions; }
  get(id: string): Session | undefined { return this.sessions.find((s) => s.id === id); }
  get active(): Session | undefined { return this.activeId ? this.get(this.activeId) : undefined; }
  term(id: string): TermLike | undefined { return this.rt.get(id)?.term; }

  profile(id: string): ShellProfile {
    const all = this.deps.profiles();
    return all.find((p) => p.id === id) ?? all[0]!;
  }

  title(s: Session): string {
    const fp = s.agent.firstPrompt?.replace(/\s+/g, " ").trim();
    const firstPrompt = fp && fp.length > TITLE_MAX ? `${fp.slice(0, TITLE_MAX - 1)}…` : fp;
    return resolveTitle({ manual: s.manualTitle, osc: s.oscTitle, firstPrompt, profileName: this.profile(s.profileId).name });
  }

  create(opts: CreateOptions): Session {
    const id = `${this.uuid()}-${this.seq++}`;
    const s: Session = {
      id, kind: opts.kind, profileId: opts.profileId, cwd: opts.cwd, command: opts.command,
      status: "running", lastOutputAt: this.now(), agent: initialAgent(),
    };
    const rt: Runtime = { term: undefined as unknown as TermLike, ptyId: null, gen: 0, cmdSent: true, cmdSentAt: 0, inputSeen: false, dirty: false };
    rt.term = this.deps.makeTerm(this.handlers(s, rt));
    this.sessions.push(s);
    this.rt.set(id, rt);
    this.start(s, rt);
    this.activeId = id;
    this.emit();
    return s;
  }

  private handlers(s: Session, rt: Runtime): TermHandlers {
    return {
      onInput: (d) => {
        if (!rt.ptyId || s.status !== "running") return;
        rt.inputSeen = true;
        if (!s.agent.hasHookEvents) this.dispatch(s, { type: "viewed" });
        this.deps.pty.write(rt.ptyId, d);
      },
      onResize: (c, r) => { if (rt.ptyId && s.status === "running") this.deps.pty.resize(rt.ptyId, c, r); },
      onTitle: (t) => { s.oscTitle = t; this.emit(); },
      onBell: () => { if (s.status === "running") this.dispatch(s, { type: "bell" }); },
    };
  }

  private start(s: Session, rt: Runtime, keep?: { claudeSessionId?: boolean }, command?: string): void {
    const p = this.profile(s.profileId);
    const gen = ++rt.gen;
    s.status = "running";
    delete s.exitCode;
    const prevAgent = s.agent;
    s.agent = initialAgent();
    if (keep) {
      if (prevAgent.firstPrompt) s.agent.firstPrompt = prevAgent.firstPrompt;
      if (keep.claudeSessionId && prevAgent.claudeSessionId) s.agent.claudeSessionId = prevAgent.claudeSessionId;
    }
    if (this.deps.cwdExists && !this.deps.cwdExists(s.cwd)) {
      const root = this.deps.fallbackCwd?.();
      if (root) {
        this.deps.notify?.(`kyle-term: folder not found (${s.cwd}); starting in the vault root`);
        s.cwd = root;
      }
    }
    rt.inputSeen = false;
    s.lastOutputAt = this.now();
    rt.command = command ?? s.command;
    rt.cmdSent = !(s.kind === "claude" && rt.command);
    this.clearTimers(rt);
    rt.ptyId = this.deps.pty.spawnSession(
      {
        shell: p.shell, args: p.args, cwd: s.cwd, cols: rt.term.cols, rows: rt.term.rows,
        env: { ...this.deps.env?.(), KYLE_TERM_SESSION: s.id },
      },
      {
        onData: (d) => {
          if (rt.gen !== gen) return;
          s.lastOutputAt = this.now();
          rt.dirty = true;
          rt.term.write(d);
          this.armCommand(s, rt);
          this.armIdle(s, rt);
        },
        onExit: (code) => {
          if (rt.gen !== gen) return;
          this.clearTimers(rt);
          s.status = "exited";
          s.exitCode = code;
          this.dispatch(s, { type: "exit" });
          rt.term.write(`\r\n[process exited with code ${code}]\r\n`);
          this.emit();
        },
      },
    );
    if (!rt.cmdSent) rt.fallbackTimer = setTimeout(() => this.sendCommand(s, rt), FALLBACK_MS);
  }

  /** Claude sessions: type the command into the shell once its startup output goes quiet. */
  private armCommand(s: Session, rt: Runtime): void {
    if (rt.cmdSent) return;
    if (rt.quietTimer) clearTimeout(rt.quietTimer);
    rt.quietTimer = setTimeout(() => this.sendCommand(s, rt), QUIET_MS);
  }

  private sendCommand(s: Session, rt: Runtime): void {
    if (rt.cmdSent || !rt.ptyId || s.status !== "running") return;
    rt.cmdSent = true;
    rt.cmdSentAt = this.now();
    this.clearTimers(rt);
    this.deps.pty.write(rt.ptyId, `${rt.command}\r`);
  }

  /** Fallback for CLIs without hooks: output after user input means busy; quiet means finished. */
  private armIdle(s: Session, rt: Runtime): void {
    if (s.agent.hasHookEvents || !rt.inputSeen) return;
    this.dispatch(s, { type: "output" });
    if (rt.idleTimer) clearTimeout(rt.idleTimer);
    rt.idleTimer = setTimeout(() => this.dispatch(s, { type: "idle" }), this.deps.idleMs?.() ?? 10_000);
  }

  private clearTimers(rt: Runtime): void {
    if (rt.idleTimer) clearTimeout(rt.idleTimer);
    rt.idleTimer = undefined;
    if (rt.quietTimer) clearTimeout(rt.quietTimer);
    if (rt.fallbackTimer) clearTimeout(rt.fallbackTimer);
    rt.quietTimer = rt.fallbackTimer = undefined;
  }

  setActive(id: string): void {
    const s = this.get(id);
    if (!s || this.activeId === id) return;
    this.activeId = id;
    this.dispatch(s, { type: "viewed" });
    this.emit();
  }

  step(delta: 1 | -1): void {
    const n = this.sessions.length;
    if (n < 2 || !this.activeId) return;
    const i = this.sessions.findIndex((s) => s.id === this.activeId);
    this.setActive(this.sessions[(i + delta + n) % n]!.id);
  }
  next(): void { this.step(1); }
  prev(): void { this.step(-1); }

  /** Empty/whitespace name unpins (falls back to automatic titles). */
  rename(id: string, name: string): void {
    const s = this.get(id);
    if (!s) return;
    const t = name.trim();
    if (t) s.manualTitle = t; else delete s.manualTitle;
    this.emit();
  }

  setColor(id: string, color: string | undefined): void {
    const s = this.get(id);
    if (!s) return;
    if (color) s.color = color; else delete s.color;
    this.emit();
  }

  restart(id: string): void {
    const s = this.get(id);
    const rt = this.rt.get(id);
    if (!s || !rt) return;
    if (s.status === "running" && rt.ptyId) this.deps.pty.kill(rt.ptyId);
    if (s.status === "stopped") {
      this.start(s, rt, {}); // keep the greyed history; new output goes below it
    } else {
      rt.term.reset();
      delete s.oscTitle;
      this.start(s, rt);
    }
    this.emit();
  }

  canResume(s: Session): boolean {
    return s.status === "stopped" && s.kind === "claude" && /^[\w-]+$/.test(s.agent.claudeSessionId ?? "") && !!this.deps.resumeCommand;
  }

  /** Stopped Claude session: start a shell in its folder and run `claude --resume <id>`. */
  resume(id: string): void {
    const s = this.get(id);
    const rt = this.rt.get(id);
    if (!s || !rt || !this.canResume(s)) return;
    this.start(s, rt, { claudeSessionId: true }, this.deps.resumeCommand!(s.agent.claudeSessionId!));
    this.emit();
  }

  /** Metadata for every session, in order. */
  snapshot(): PersistedSession[] { return serializeSessions(this.sessions, this.now()); }

  /** Scrollback text for a session, or undefined when unchanged since the last save / unsupported. */
  takeScrollback(id: string, lines: number, force = false): string | undefined {
    const rt = this.rt.get(id);
    if (!rt || !rt.term.serialize) return undefined;
    const s = this.get(id);
    if (!rt.dirty && !(force && s?.status !== "stopped")) return undefined;
    try {
      const out = rt.term.serialize(lines);
      rt.dirty = false;
      return out;
    } catch { return undefined; }
  }

  /** Bring sessions back as stopped rows, with their saved history greyed out above a divider. */
  restore(saved: readonly PersistedSession[], scrollback: (id: string) => string | undefined): void {
    for (const p of saved) {
      if (this.get(p.id)) continue;
      const s: Session = {
        id: p.id, kind: p.kind, profileId: p.profileId, cwd: p.cwd, command: p.command,
        manualTitle: p.manualTitle, oscTitle: p.oscTitle, color: p.color,
        status: "stopped", lastOutputAt: p.lastOutputAt, agent: { ...initialAgent(), state: "exited" },
      };
      if (p.firstPrompt) s.agent.firstPrompt = p.firstPrompt;
      if (p.claudeSessionId) s.agent.claudeSessionId = p.claudeSessionId;
      const rt: Runtime = { term: undefined as unknown as TermLike, ptyId: null, gen: 0, cmdSent: true, cmdSentAt: 0, inputSeen: false, dirty: false };
      rt.term = this.deps.makeTerm(this.handlers(s, rt));
      const text = scrollback(p.id);
      rt.term.write(`${text ? dimScrollback(text) : ""}${dividerLine(p.lastOutputAt || p.savedAt)}`);
      this.sessions.push(s);
      this.rt.set(p.id, rt);
    }
    if (!this.activeId && this.sessions[0]) this.activeId = this.sessions[0].id;
    this.emit();
  }

  /** Kills the process; the row stays (exited) until closed. */
  kill(id: string): void {
    const s = this.get(id);
    const rt = this.rt.get(id);
    if (s?.status === "running" && rt?.ptyId) this.deps.pty.kill(rt.ptyId);
  }

  /** Removes the row, killing the process first if still running. */
  close(id: string): void {
    const i = this.sessions.findIndex((s) => s.id === id);
    const rt = this.rt.get(id);
    if (i < 0 || !rt) return;
    rt.gen++;
    this.clearTimers(rt);
    if (this.sessions[i]!.status === "running" && rt.ptyId) this.deps.pty.kill(rt.ptyId);
    rt.term.dispose();
    this.rt.delete(id);
    this.sessions.splice(i, 1);
    this.deps.onClosed?.(id);
    if (this.activeId === id) this.activeId = (this.sessions[i] ?? this.sessions[i - 1])?.id ?? null;
    this.emit();
  }

  move(id: string, toIndex: number): void {
    const from = this.sessions.findIndex((s) => s.id === id);
    if (from < 0) return;
    const to = Math.max(0, Math.min(this.sessions.length - 1, toIndex));
    if (to === from) return;
    const [s] = this.sessions.splice(from, 1);
    this.sessions.splice(to, 0, s!);
    this.emit();
  }

  dispose(): void {
    for (const [id, rt] of this.rt) {
      rt.gen++;
      this.clearTimers(rt);
      if (rt.ptyId) this.deps.pty.kill(rt.ptyId);
      rt.term.dispose();
      this.rt.delete(id);
    }
    if (this.soon) clearTimeout(this.soon);
    if (this.fade) clearTimeout(this.fade);
    this.sessions = [];
    this.activeId = null;
    this.listeners.clear();
    this.stateListeners.clear();
    this.subDoneListeners.clear();
  }
}
