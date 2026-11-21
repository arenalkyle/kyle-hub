import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { encode, LineDecoder, type FromHelper, type ToHelper } from "./protocol";

export interface SpawnOptions {
  shell: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  env?: Record<string, string>;
}

export interface SessionListener {
  onData(data: string): void;
  onExit(code: number, signal?: number): void;
}

/** Plugin-owned PTY host: owns the helper process and all sessions (sessions outlive views). */
export class PtyManager {
  private child: ChildProcessWithoutNullStreams | null = null;
  private listeners = new Map<string, SessionListener>();
  private pending: ToHelper[] = [];
  private ready = false;
  private nextId = 1;
  onError: (message: string) => void = () => {};

  constructor(private nodePath: string, private helperPath: string, private helperEnv?: Record<string, string>) {}

  private ensureHelper(): void {
    if (this.child) return;
    const child = spawn(this.nodePath, [this.helperPath], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, ...(this.helperEnv ? { env: { ...process.env, ...this.helperEnv } } : {}) });
    this.child = child;
    const dec = new LineDecoder<FromHelper>();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      for (const m of dec.push(chunk)) this.handle(m);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (s: string) => this.onError(s.trim()));
    child.on("error", (e) => this.onError(`helper failed to start: ${e.message}`));
    child.on("exit", () => {
      if (this.child === child) this.child = null;
      this.ready = false;
      for (const l of this.listeners.values()) l.onExit(-1);
      this.listeners.clear();
    });
    child.stdin.on("error", () => {});
  }

  private handle(m: FromHelper): void {
    switch (m.t) {
      case "ready":
        this.ready = true;
        for (const p of this.pending) this.send(p);
        this.pending = [];
        break;
      case "data":
        this.listeners.get(m.id)?.onData(m.data);
        break;
      case "exit":
        this.listeners.get(m.id)?.onExit(m.code, m.signal);
        this.listeners.delete(m.id);
        break;
      case "error":
        this.onError(m.message);
        break;
    }
  }

  private send(m: ToHelper): void {
    if (!this.ready) {
      this.pending.push(m);
      return;
    }
    this.child?.stdin.write(encode(m));
  }

  spawnSession(opts: SpawnOptions, listener: SessionListener): string {
    this.ensureHelper();
    const id = `s${this.nextId++}`;
    this.listeners.set(id, listener);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    Object.assign(env, opts.env);
    this.send({ t: "spawn", id, shell: opts.shell, args: opts.args, cwd: opts.cwd, cols: opts.cols, rows: opts.rows, env });
    return id;
  }

  /** Swap the listener (e.g. when a view reattaches). */
  attach(id: string, listener: SessionListener): void {
    if (this.listeners.has(id)) this.listeners.set(id, listener);
  }

  write(id: string, data: string): void { this.send({ t: "write", id, data }); }
  resize(id: string, cols: number, rows: number): void { this.send({ t: "resize", id, cols, rows }); }
  kill(id: string): void { this.send({ t: "kill", id }); }

  dispose(): void {
    const c = this.child;
    this.child = null;
    this.listeners.clear();
    if (!c) return;
    try { c.stdin.end(); } catch { /* ignore */ }
    setTimeout(() => { if (c.exitCode === null) c.kill(); }, 1000).unref?.();
  }
}
