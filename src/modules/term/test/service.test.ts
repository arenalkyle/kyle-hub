import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus, type HubEvents, type SessionInfo, type SessionState } from "../../../core";
import { SessionManager, type PtyLike, type Session, type TermHandlers, type TermLike } from "../src/session-manager";
import type { SessionListener, SpawnOptions } from "../src/pty-manager";
import type { ShellProfile } from "../src/shells";
import { createSessionService, wireSessionEvents } from "../src/service";

const profiles: ShellProfile[] = [{ id: "powershell", name: "PowerShell 5.1", shell: "powershell.exe", args: ["-NoLogo"] }];

class MockPty implements PtyLike {
  n = 0;
  spawned: { id: string; opts: SpawnOptions }[] = [];
  listeners = new Map<string, SessionListener>();
  written: { id: string; data: string }[] = [];
  spawnSession(opts: SpawnOptions, l: SessionListener): string {
    const id = `p${++this.n}`;
    this.spawned.push({ id, opts });
    this.listeners.set(id, l);
    return id;
  }
  write(id: string, data: string): void { this.written.push({ id, data }); }
  resize(): void {}
  kill(id: string): void { this.listeners.get(id)?.onExit(137); }
}

class MockTerm implements TermLike {
  cols = 100; rows = 30;
  constructor(public h: TermHandlers) {}
  write(): void {}
  paste(): void {}
  reset(): void {}
  dispose(): void {}
  attach(): void {}
  fit(): void {}
  focus(): void {}
}

let pty: MockPty;
let m: SessionManager;
let bus: EventBus;
let seen: Array<[keyof HubEvents, unknown]>;
let activated: number;

beforeEach(() => {
  vi.useFakeTimers();
  pty = new MockPty();
  m = new SessionManager({ pty, profiles: () => profiles, makeTerm: (h) => new MockTerm(h) });
  bus = new EventBus();
  seen = [];
  activated = 0;
  for (const e of ["session:started", "session:ended", "session:needs-attention"] as const) bus.on(e, (p) => seen.push([e, p]));
  wireSessionEvents(m, bus);
});
afterEach(() => vi.useRealTimers());

const hook = (id: string, event: string, payload: Record<string, unknown> = {}) => m.handleHook(id, event, payload);

describe("session bus events", () => {
  it("emits started on create and ended on exit", () => {
    const s = m.create({ kind: "shell", profileId: "powershell", cwd: "C:\\v" });
    expect(seen).toEqual([["session:started", { sessionId: s.id }]]);
    pty.listeners.get("p1")!.onExit(0);
    expect(seen[1]).toEqual(["session:ended", { sessionId: s.id }]);
  });
  it("emits ended when a running session is closed", () => {
    const s = m.create({ kind: "shell", profileId: "powershell", cwd: "x" });
    m.close(s.id);
    expect(seen.filter(([e]) => e === "session:ended")).toHaveLength(1);
  });
  it("emits needs-attention with the Claude session id once hooks reported it", () => {
    const s = m.create({ kind: "claude", profileId: "powershell", cwd: "x", command: "claude" });
    hook(s.id, "SessionStart", { session_id: "claude-123" });
    hook(s.id, "UserPromptSubmit", { prompt: "go" });
    hook(s.id, "Notification", { notification_type: "permission_prompt", message: "Allow?" });
    const attn = seen.filter(([e]) => e === "session:needs-attention");
    expect(attn).toEqual([["session:needs-attention", { sessionId: s.id, claudeSessionId: "claude-123" }]]);
  });
  it("emits started again for a restart", () => {
    const s = m.create({ kind: "shell", profileId: "powershell", cwd: "x" });
    m.restart(s.id);
    expect(seen.filter(([e]) => e === "session:started")).toHaveLength(2);
  });
});

describe("SessionService", () => {
  const make = () => {
    const listeners = new Set<(s: Session, prev: SessionState) => void>();
    m.onStateChange((s, prev) => listeners.forEach((l) => l(s, prev)));
    return createSessionService(
      { getSessions: () => m, defaultProfileId: () => "powershell", vaultRoot: () => "C:\\vault", activateView: async () => void activated++ },
      (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    );
  };

  it("spawn creates an agent session with env, title, cwd and quoted args", () => {
    const svc = make();
    const info = svc.spawn({ command: "claude", args: ["--model", "opus 4", "-p"], cwd: "C:\\w", env: { KH_TICKET: "KH-1" }, title: "Ticket KH-1" });
    expect(info).toMatchObject({ kind: "claude", cwd: "C:\\w", title: "Ticket KH-1", state: "idle" });
    expect(pty.spawned[0]!.opts.env).toMatchObject({ KH_TICKET: "KH-1", KYLE_TERM_SESSION: info.id });
    pty.listeners.get("p1")!.onData("PS> ");
    vi.advanceTimersByTime(500);
    expect(pty.written.at(-1)!.data).toBe('claude --model "opus 4" -p\r');
  });
  it("spawn without a command is a plain shell in the vault root", () => {
    const svc = make();
    expect(svc.spawn({})).toMatchObject({ kind: "shell", cwd: "C:\\vault" });
  });
  it("list/get reflect state and the Claude session id", () => {
    const svc = make();
    const a = svc.spawn({ command: "claude" });
    hook(a.id, "SessionStart", { session_id: "abc" });
    hook(a.id, "UserPromptSubmit", { prompt: "x" });
    expect(svc.get(a.id)).toMatchObject({ state: "working", claudeSessionId: "abc" });
    expect(svc.list().map((i) => i.id)).toEqual([a.id]);
    expect(svc.get("nope")).toBeUndefined();
  });
  it("onState fires on changes until unsubscribed", () => {
    const svc = make();
    const got: Array<[SessionInfo["state"], SessionState]> = [];
    const off = svc.onState((i, prev) => got.push([i.state, prev]));
    const s = svc.spawn({ command: "claude" });
    hook(s.id, "UserPromptSubmit", { prompt: "x" });
    hook(s.id, "Stop");
    off();
    hook(s.id, "UserPromptSubmit", { prompt: "y" });
    expect(got).toEqual([["working", "idle"], ["finished", "working"]]);
  });
  it("tail strips escape codes; close removes the session and emits ended", () => {
    const esc = String.fromCharCode(27);
    const svc = make();
    m = new SessionManager({
      pty, profiles: () => profiles,
      makeTerm: (h) => Object.assign(new MockTerm(h), { serialize: () => `${esc}[32mPS C:\\v>${esc}[0m \r\n` }),
    });
    const svc2 = createSessionService(
      { getSessions: () => m, defaultProfileId: () => "powershell", vaultRoot: () => "C:\\v", activateView: async () => {} },
      () => () => {},
    );
    void svc;
    const s = svc2.spawn({});
    expect(svc2.tail(s.id, 5)).toBe("PS C:\\v> \n");
    svc2.close(s.id);
    expect(svc2.list()).toEqual([]);
  });
  it("focus reveals the view and selects the session", async () => {
    const svc = make();
    const a = svc.spawn({});
    const b = svc.spawn({});
    expect(m.active?.id).toBe(b.id);
    await svc.focus(a.id);
    expect(activated).toBe(1);
    expect(m.active?.id).toBe(a.id);
  });
});
