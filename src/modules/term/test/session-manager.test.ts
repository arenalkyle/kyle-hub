import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManager, type PtyLike, type TermHandlers, type TermLike } from "../src/session-manager";
import type { SessionListener, SpawnOptions } from "../src/pty-manager";
import type { ShellProfile } from "../src/shells";
import { initialAgent } from "../src/agent-state";

const profiles: ShellProfile[] = [
  { id: "powershell", name: "PowerShell 5.1", shell: "powershell.exe", args: ["-NoLogo"] },
  { id: "cmd", name: "Command Prompt", shell: "cmd.exe", args: [] },
];

class MockPty implements PtyLike {
  n = 0;
  spawned: { id: string; opts: SpawnOptions }[] = [];
  listeners = new Map<string, SessionListener>();
  written: { id: string; data: string }[] = [];
  killed: string[] = [];
  spawnSession(opts: SpawnOptions, l: SessionListener): string {
    const id = `p${++this.n}`;
    this.spawned.push({ id, opts });
    this.listeners.set(id, l);
    return id;
  }
  write(id: string, data: string): void { this.written.push({ id, data }); }
  resize(): void {}
  kill(id: string): void {
    this.killed.push(id);
    this.listeners.get(id)?.onExit(137);
  }
}

class MockTerm implements TermLike {
  cols = 100; rows = 30; out = ""; resets = 0; disposed = false;
  constructor(public h: TermHandlers) {}
  write(d: string): void { this.out += d; }
  pasted: string[] = [];
  paste(t: string): void { this.pasted.push(t); }
  reset(): void { this.resets++; this.out = ""; }
  dispose(): void { this.disposed = true; }
  attach(): void {}
  fit(): void {}
  focus(): void {}
}

let pty: MockPty;
let terms: MockTerm[];
let m: SessionManager;
let clock: number;

beforeEach(() => {
  vi.useFakeTimers();
  pty = new MockPty();
  terms = [];
  clock = 1000;
  m = new SessionManager({
    pty,
    profiles: () => profiles,
    makeTerm: (h) => { const t = new MockTerm(h); terms.push(t); return t; },
    now: () => clock,
  });
});
afterEach(() => vi.useRealTimers());

const shell = () => m.create({ kind: "shell", profileId: "powershell", cwd: "C:\\v" });

describe("terminal reports", () => {
  const reports = ["\x1b[?1;2c", "\x1b[>0;276;0c", "\x1b[11;3R", "\x1b[O", "\x1b[I", "\x1b[?2026;2$y", "\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\"];

  it.each(reports)("forwards %j without treating it as typing", (report) => {
    const s = shell();
    terms[0]!.h.onInput(report);
    pty.listeners.get([...pty.listeners.keys()][0]!)!.onData("output");
    expect(pty.written.map((w) => w.data)).toContain(report);
    expect(s.agent.state).toBe(initial);
  });

  it("still treats a key as typing", () => {
    const s = shell();
    terms[0]!.h.onInput("x");
    pty.listeners.get([...pty.listeners.keys()][0]!)!.onData("output");
    expect(s.agent.state).not.toBe(initial);
  });

  const initial = initialAgent().state;
});

describe("create", () => {
  it("spawns with profile, cwd and term size, and becomes active", () => {
    const s = shell();
    expect(pty.spawned[0]!.opts).toMatchObject({ shell: "powershell.exe", args: ["-NoLogo"], cwd: "C:\\v", cols: 100, rows: 30 });
    expect(m.active?.id).toBe(s.id);
    expect(s.status).toBe("running");
  });
  it("falls back to first profile when profile is unknown", () => {
    m.create({ kind: "shell", profileId: "gone", cwd: "x" });
    expect(pty.spawned[0]!.opts.shell).toBe("powershell.exe");
  });
  it("claude session types the command once output goes quiet", () => {
    const s = m.create({ kind: "claude", profileId: "powershell", cwd: "C:\\v", command: "claude" });
    pty.listeners.get("p1")!.onData("PS> ");
    vi.advanceTimersByTime(300);
    pty.listeners.get("p1")!.onData("more");
    vi.advanceTimersByTime(300);
    expect(pty.written).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(pty.written).toEqual([{ id: "p1", data: "claude\r" }]);
    expect(s.kind).toBe("claude");
  });
  it("claude command still sent via fallback if shell is silent", () => {
    m.create({ kind: "claude", profileId: "powershell", cwd: "x", command: "claude" });
    vi.advanceTimersByTime(5000);
    expect(pty.written).toEqual([{ id: "p1", data: "claude\r" }]);
  });
  it("shell session sends no command", () => {
    shell();
    pty.listeners.get("p1")!.onData("PS> ");
    vi.advanceTimersByTime(10000);
    expect(pty.written).toEqual([]);
  });
});

describe("io", () => {
  it("routes output to the term, updates lastOutputAt, forwards input", () => {
    const s = shell();
    clock = 5000;
    pty.listeners.get("p1")!.onData("hi");
    expect(terms[0]!.out).toBe("hi");
    expect(s.lastOutputAt).toBe(5000);
    terms[0]!.h.onInput("x");
    expect(pty.written).toEqual([{ id: "p1", data: "x" }]);
  });
  it("osc title feeds the title function; manual name pins and clearing unpins", () => {
    const s = shell();
    expect(m.title(s)).toBe("PowerShell 5.1");
    terms[0]!.h.onTitle("Fix login bug");
    expect(m.title(s)).toBe("Fix login bug");
    m.rename(s.id, "My agent");
    terms[0]!.h.onTitle("Other");
    expect(m.title(s)).toBe("My agent");
    m.rename(s.id, "  ");
    expect(m.title(s)).toBe("Other");
  });
});

describe("switch", () => {
  it("setActive, next and prev wrap", () => {
    const a = shell(), b = shell(), c = shell();
    expect(m.active?.id).toBe(c.id);
    m.next();
    expect(m.active?.id).toBe(a.id);
    m.prev();
    expect(m.active?.id).toBe(c.id);
    m.setActive(b.id);
    expect(m.active?.id).toBe(b.id);
  });
  it("emits change", () => {
    const cb = vi.fn();
    m.onChange(cb);
    const s = shell();
    cb.mockClear();
    m.setColor(s.id, "#fff");
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe("exit, restart, kill, close", () => {
  it("exit keeps the row, records the code, never auto-closes", () => {
    const s = shell();
    pty.listeners.get("p1")!.onExit(0);
    expect(m.list()).toHaveLength(1);
    expect(s.status).toBe("exited");
    expect(s.exitCode).toBe(0);
    expect(terms[0]!.out).toContain("exited with code 0");
    pty.listeners.get("p1")!.onExit(1);
    expect(m.list()).toHaveLength(1);
  });
  it("restart respawns in the same row with same profile/cwd/command and clears the term", () => {
    const s = m.create({ kind: "claude", profileId: "cmd", cwd: "C:\\proj", command: "claude" });
    pty.listeners.get("p1")!.onExit(2);
    m.restart(s.id);
    expect(m.list()).toHaveLength(1);
    expect(s.status).toBe("running");
    expect(s.exitCode).toBeUndefined();
    expect(terms[0]!.resets).toBe(1);
    expect(pty.spawned[1]!.opts).toMatchObject({ shell: "cmd.exe", cwd: "C:\\proj" });
    pty.listeners.get("p2")!.onData("$ ");
    vi.advanceTimersByTime(400);
    expect(pty.written).toEqual([{ id: "p2", data: "claude\r" }]);
  });
  it("restart of a running session kills the old process and ignores its exit", () => {
    const s = shell();
    m.restart(s.id);
    expect(pty.killed).toEqual(["p1"]);
    expect(s.status).toBe("running");
  });
  it("kill terminates but leaves the row, exited", () => {
    const s = shell();
    m.kill(s.id);
    expect(pty.killed).toEqual(["p1"]);
    expect(m.list()).toHaveLength(1);
    expect(s.status).toBe("exited");
  });
  it("close removes the row, disposes the term, and moves active to a neighbour", () => {
    const a = shell(), b = shell();
    m.close(b.id);
    expect(m.list().map((x) => x.id)).toEqual([a.id]);
    expect(terms[1]!.disposed).toBe(true);
    expect(m.active?.id).toBe(a.id);
    m.close(a.id);
    expect(m.active).toBeUndefined();
  });
});

describe("reorder", () => {
  it("move places a row at the target index", () => {
    const a = shell(), b = shell(), c = shell();
    m.move(c.id, 0);
    expect(m.list().map((x) => x.id)).toEqual([c.id, a.id, b.id]);
    m.move(c.id, 99);
    expect(m.list().map((x) => x.id)).toEqual([a.id, b.id, c.id]);
  });
});

describe("dispose", () => {
  it("kills everything and disposes terms", () => {
    shell(); shell();
    m.dispose();
    expect(pty.killed.sort()).toEqual(["p1", "p2"]);
    expect(terms.every((t) => t.disposed)).toBe(true);
    expect(m.list()).toHaveLength(0);
  });
});

describe("agent state integration", () => {
  const hook = (id: string, event: string, payload: Record<string, unknown> = {}) => m.handleHook(id, event, payload);

  it("gives every PTY session id and hook env", () => {
    const m2 = new SessionManager({
      pty, profiles: () => profiles, now: () => clock,
      makeTerm: (h) => new MockTerm(h),
      env: () => ({ KYLE_TERM_PORT: "123", KYLE_TERM_TOKEN: "tok" }),
    });
    const s = m2.create({ kind: "shell", profileId: "powershell", cwd: "x" });
    expect(pty.spawned.at(-1)!.opts.env).toEqual({ KYLE_TERM_PORT: "123", KYLE_TERM_TOKEN: "tok", KYLE_TERM_SESSION: s.id });
  });
  it("hook events drive state, title and state-change listeners", () => {
    const s = shell();
    const seen: string[] = [];
    m.onStateChange((_s, a, b) => seen.push(`${a}>${b}`));
    hook(s.id, "UserPromptSubmit", { prompt: "fix   the\nbug" });
    expect(s.agent.state).toBe("working");
    expect(m.title(s)).toBe("fix the bug");
    hook(s.id, "Stop");
    expect(seen).toEqual(["idle>working", "working>finished"]);
  });
  it("title priority keeps manual and osc above the first prompt", () => {
    const s = shell();
    hook(s.id, "UserPromptSubmit", { prompt: "hello" });
    terms[0]!.h.onTitle("Task");
    expect(m.title(s)).toBe("Task");
    m.rename(s.id, "Mine");
    expect(m.title(s)).toBe("Mine");
  });
  it("long first prompts are shortened", () => {
    const s = shell();
    hook(s.id, "UserPromptSubmit", { prompt: "x".repeat(200) });
    expect(m.title(s).length).toBeLessThanOrEqual(60);
  });
  it("viewing a session clears finished", () => {
    const a = shell();
    const b = shell();
    hook(a.id, "Stop");
    expect(a.agent.state).toBe("finished");
    m.setActive(a.id);
    expect(a.agent.state).toBe("idle");
    expect(b.agent.state).toBe("idle");
  });
  it("process exit overrides state", () => {
    const s = shell();
    hook(s.id, "UserPromptSubmit");
    pty.listeners.get("p1")!.onExit(0);
    expect(s.agent.state).toBe("exited");
  });
  it("activity-only updates are throttled", () => {
    const s = shell();
    let n = 0;
    m.onChange(() => n++);
    for (let i = 0; i < 10; i++) hook(s.id, "PreToolUse", { tool_name: "Bash", tool_input: { command: `c${i}` } });
    expect(n).toBe(1); // first call changed state; the rest only changed activity
    vi.advanceTimersByTime(400);
    expect(n).toBe(2);
    expect(s.agent.activity).toBe("Running c9");
  });
  it("bell and idle fallback apply only to never-hooked sessions", () => {
    const s = shell();
    terms[0]!.h.onBell();
    expect(s.agent.state).toBe("needs-input");
    terms[0]!.h.onInput("y");
    pty.listeners.get("p1")!.onData("output");
    expect(s.agent.state).toBe("working");
    vi.advanceTimersByTime(10_001);
    expect(s.agent.state).toBe("finished");
    const h = shell();
    hook(h.id, "SessionStart", { session_id: "c1" });
    terms[1]!.h.onBell();
    expect(h.agent.state).toBe("idle");
    expect(h.agent.claudeSessionId).toBe("c1");
  });
  it("restart resets agent state", () => {
    const s = shell();
    hook(s.id, "Stop");
    m.restart(s.id);
    expect(s.agent.state).toBe("idle");
    expect(s.agent.hasHookEvents).toBe(false);
  });

  it("fires onSubAgentDone once when a sub-agent finishes", () => {
    const s = shell();
    let n = 0;
    m.onSubAgentDone(() => n++);
    m.handleHook(s.id, "SubagentStart", { agent_id: "x", agent_type: "t" });
    expect(n).toBe(0);
    m.handleHook(s.id, "SubagentStop", { agent_id: "x" });
    expect(n).toBe(1);
    m.handleHook(s.id, "SubagentStop", { agent_id: "x" });
    expect(n).toBe(1);
  });
});

describe("sendText / whenReady", () => {
  const tick = (ms: number) => { clock += ms; vi.advanceTimersByTime(ms); };
  it("sendText pastes (never Enter) into a running session and fails for exited", () => {
    const s = shell();
    expect(m.sendText(s.id, "@a.md")).toBe(true);
    expect(terms[0]!.pasted).toEqual(["@a.md"]);
    expect(pty.written).toEqual([]);
    pty.listeners.get("p1")!.onExit(0);
    expect(m.sendText(s.id, "x")).toBe(false);
    expect(m.sendText("nope", "x")).toBe(false);
  });
  it("whenReady resolves on a hook event", async () => {
    const s = m.create({ kind: "claude", profileId: "powershell", cwd: "x", command: "claude" });
    const p = m.whenReady(s.id);
    m.handleHook(s.id, "SessionStart", {});
    tick(100);
    await expect(p).resolves.toBe(true);
  });
  it("whenReady resolves after output is quiet once the command was sent", async () => {
    const s = m.create({ kind: "claude", profileId: "powershell", cwd: "x", command: "claude" });
    const p = m.whenReady(s.id);
    tick(5000); // fallback types the command
    tick(1400);
    let done: boolean | undefined;
    void p.then((v) => { done = v; });
    await Promise.resolve();
    expect(done).toBeUndefined();
    pty.listeners.get("p1")!.onData("banner");
    tick(1400);
    await Promise.resolve();
    expect(done).toBeUndefined();
    tick(200);
    await expect(p).resolves.toBe(true);
  });
  it("whenReady times out and resolves false", async () => {
    const s = m.create({ kind: "claude", profileId: "powershell", cwd: "x", command: "claude" });
    const p = m.whenReady(s.id, 1e9, 3000);
    tick(3200);
    await expect(p).resolves.toBe(false);
  });
});
