import type { ShellProfile } from "./shells";
import { resolveTitle } from "./title";
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
  status: "running" | "exited";
  exitCode?: number;
  lastOutputAt: number;
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
}

export interface TermLike {
  cols: number;
  rows: number;
  write(data: string): void;
  reset(): void;
  dispose(): void;
  attach(parent: HTMLElement): void;
  fit(): void;
  focus(): void;
}

export type TermFactory = (handlers: TermHandlers) => TermLike;

export interface SessionManagerDeps {
  pty: PtyLike;
  makeTerm: TermFactory;
  profiles: () => ShellProfile[];
  now?: () => number;
  uuid?: () => string;
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
  quietTimer?: ReturnType<typeof setTimeout>;
  fallbackTimer?: ReturnType<typeof setTimeout>;
}

const QUIET_MS = 400;
const FALLBACK_MS = 5000;

/** Plugin-owned session state; sessions (and their terminals) outlive any view. */
export class SessionManager {
  private sessions: Session[] = [];
  private rt = new Map<string, Runtime>();
  private listeners = new Set<() => void>();
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

  list(): readonly Session[] { return this.sessions; }
  get(id: string): Session | undefined { return this.sessions.find((s) => s.id === id); }
  get active(): Session | undefined { return this.activeId ? this.get(this.activeId) : undefined; }
  term(id: string): TermLike | undefined { return this.rt.get(id)?.term; }

  profile(id: string): ShellProfile {
    const all = this.deps.profiles();
    return all.find((p) => p.id === id) ?? all[0]!;
  }

  title(s: Session): string {
    return resolveTitle({ manual: s.manualTitle, osc: s.oscTitle, profileName: this.profile(s.profileId).name });
  }

  create(opts: CreateOptions): Session {
    const id = `${this.uuid()}-${this.seq++}`;
    const s: Session = {
      id, kind: opts.kind, profileId: opts.profileId, cwd: opts.cwd, command: opts.command,
      status: "running", lastOutputAt: this.now(),
    };
    const rt: Runtime = { term: undefined as unknown as TermLike, ptyId: null, gen: 0, cmdSent: true };
    rt.term = this.deps.makeTerm({
      onInput: (d) => { if (rt.ptyId && s.status === "running") this.deps.pty.write(rt.ptyId, d); },
      onResize: (c, r) => { if (rt.ptyId && s.status === "running") this.deps.pty.resize(rt.ptyId, c, r); },
      onTitle: (t) => { s.oscTitle = t; this.emit(); },
    });
    this.sessions.push(s);
    this.rt.set(id, rt);
    this.start(s, rt);
    this.activeId = id;
    this.emit();
    return s;
  }

  private start(s: Session, rt: Runtime): void {
    const p = this.profile(s.profileId);
    const gen = ++rt.gen;
    s.status = "running";
    delete s.exitCode;
    s.lastOutputAt = this.now();
    rt.cmdSent = !(s.kind === "claude" && s.command);
    this.clearTimers(rt);
    rt.ptyId = this.deps.pty.spawnSession(
      { shell: p.shell, args: p.args, cwd: s.cwd, cols: rt.term.cols, rows: rt.term.rows },
      {
        onData: (d) => {
          if (rt.gen !== gen) return;
          s.lastOutputAt = this.now();
          rt.term.write(d);
          this.armCommand(s, rt);
        },
        onExit: (code) => {
          if (rt.gen !== gen) return;
          this.clearTimers(rt);
          s.status = "exited";
          s.exitCode = code;
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
    this.clearTimers(rt);
    this.deps.pty.write(rt.ptyId, `${s.command}\r`);
  }

  private clearTimers(rt: Runtime): void {
    if (rt.quietTimer) clearTimeout(rt.quietTimer);
    if (rt.fallbackTimer) clearTimeout(rt.fallbackTimer);
    rt.quietTimer = rt.fallbackTimer = undefined;
  }

  setActive(id: string): void {
    if (!this.get(id) || this.activeId === id) return;
    this.activeId = id;
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
    rt.term.reset();
    delete s.oscTitle;
    this.start(s, rt);
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
    this.sessions = [];
    this.activeId = null;
    this.listeners.clear();
  }
}
