import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dimScrollback, dividerLine, orphanFiles, parsePersisted, serializeSessions, trimLines } from "../src/persist";
import { SessionManager, type PtyLike, type TermHandlers, type TermLike } from "../src/session-manager";
import type { SessionListener, SpawnOptions } from "../src/pty-manager";
import type { ShellProfile } from "../src/shells";

class MockPty implements PtyLike {
  n = 0;
  spawned: SpawnOptions[] = [];
  written: string[] = [];
  listeners: SessionListener[] = [];
  spawnSession(opts: SpawnOptions, l: SessionListener): string { this.spawned.push(opts); this.listeners.push(l); return `p${++this.n}`; }
  write(_id: string, d: string): void { this.written.push(d); }
  resize(): void {}
  kill(): void {}
}
class MockTerm implements TermLike {
  cols = 80; rows = 24; out = ""; resets = 0; ser = "SER";
  constructor(public h: TermHandlers) {}
  write(d: string): void { this.out += d; }
  paste(): void {}
  reset(): void { this.resets++; this.out = ""; }
  dispose(): void {}
  attach(): void {}
  fit(): void {}
  focus(): void {}
  serialize(): string { return this.ser; }
}
const PROFILES: ShellProfile[] = [{ id: "powershell", name: "PowerShell", shell: "powershell.exe", args: [] }];
let pty: MockPty;
let terms: MockTerm[];
let notices: string[];
let existing: boolean;
function makeManager(): SessionManager {
  pty = new MockPty();
  terms = [];
  notices = [];
  existing = true;
  return new SessionManager({
    pty,
    profiles: () => PROFILES,
    makeTerm: (h) => { const t = new MockTerm(h); terms.push(t); return t; },
    now: () => 1000,
    resumeCommand: (id) => `claude --resume ${id}`,
    cwdExists: () => existing,
    fallbackCwd: () => "C:\\vault",
    notify: (m) => notices.push(m),
  });
}

describe("metadata round-trip", () => {
  it("serialises every field and reads it back", () => {
    const m = makeManager();
    const s = m.create({ kind: "claude", profileId: "powershell", cwd: "C:\\v", command: "claude" });
    m.rename(s.id, "Mine");
    m.setColor(s.id, "#e5534b");
    s.oscTitle = "auto";
    m.handleHook(s.id, "SessionStart", { session_id: "abc-123" });
    m.handleHook(s.id, "UserPromptSubmit", { prompt: "do the thing" });
    const json = JSON.parse(JSON.stringify(serializeSessions(m.list(), 5000)));
    const [p] = parsePersisted(json);
    expect(p).toMatchObject({
      id: s.id, kind: "claude", profileId: "powershell", cwd: "C:\\v", command: "claude", manualTitle: "Mine",
      oscTitle: "auto", firstPrompt: "do the thing", color: "#e5534b", claudeSessionId: "abc-123", savedAt: 5000,
    });
    expect(p!.lastOutputAt).toBe(s.lastOutputAt);
  });

  it("tolerates old/missing/garbage fields", () => {
    const out = parsePersisted([
      { id: "a" },
      { id: "b", kind: "weird", cwd: 5, lastOutputAt: "x", extra: true, manualTitle: "" },
      { id: "../evil" },
      { id: "a" },
      null,
      "str",
      {},
    ]);
    expect(out.map((p) => p.id)).toEqual(["a", "b"]);
    expect(out[0]).toEqual({ id: "a", kind: "shell", profileId: "", cwd: "", lastOutputAt: 0, savedAt: 0 });
    expect(out[1]!.kind).toBe("shell");
    expect(out[1]!.manualTitle).toBeUndefined();
  });

  it("non-array input gives an empty list", () => {
    expect(parsePersisted(undefined)).toEqual([]);
    expect(parsePersisted({ a: 1 })).toEqual([]);
  });
});

describe("orphanFiles", () => {
  it("returns only unknown <id>.txt files", () => {
    expect(orphanFiles(["a.txt", "b.txt", "c.txt", "notes.md", "x/y.txt", ".hidden"], ["a", "c"])).toEqual(["b.txt"]);
  });
  it("with no sessions everything scrollback-shaped is an orphan", () => {
    expect(orphanFiles(["a.txt", "b.txt"], [])).toEqual(["a.txt", "b.txt"]);
  });
});

describe("text helpers", () => {
  it("trims to the last n lines", () => {
    expect(trimLines("1\n2\n3\n4", 2)).toBe("3\n4");
    expect(trimLines("1\n2", 5)).toBe("1\n2");
  });
  it("dims and strips colours", () => {
    const out = dimScrollback("\x1b[31mred\x1b[0m\r\nplain\r\n\r\n");
    expect(out).toBe("\x1b[2mred\x1b[0m\r\n\x1b[2mplain\x1b[0m\r\n");
    expect(dimScrollback("  \r\n")).toBe("");
  });
  it("divider carries the wording", () => {
    expect(dividerLine(0)).toContain("session ended, restored from");
  });
});

describe("restore / resume", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const saved = (o: object = {}) =>
    parsePersisted([{ id: "s1", kind: "claude", profileId: "powershell", cwd: "C:\\proj", command: "claude", claudeSessionId: "sid-1", firstPrompt: "hi", manualTitle: "T", lastOutputAt: 10, savedAt: 20, ...o }]);

  it("restores stopped rows in order with greyed history and divider, not accepting input", () => {
    const m = makeManager();
    m.restore(parsePersisted([{ id: "a" }, { id: "b" }]), (id) => (id === "a" ? "\x1b[31mold\x1b[0m" : undefined));
    expect(m.list().map((s) => [s.id, s.status])).toEqual([["a", "stopped"], ["b", "stopped"]]);
    expect(terms[0]!.out).toContain("\x1b[2mold\x1b[0m");
    expect(terms[0]!.out).toContain("session ended, restored from");
    expect(pty.spawned).toHaveLength(0);
    terms[0]!.h.onInput("x");
    expect(pty.written).toHaveLength(0);
  });

  it("Resume runs the claude command with --resume in the original folder, keeping history and id", () => {
    const m = makeManager();
    m.restore(saved(), () => "hist");
    const s = m.get("s1")!;
    expect(m.canResume(s)).toBe(true);
    m.resume("s1");
    expect(s.status).toBe("running");
    expect(pty.spawned[0]!.cwd).toBe("C:\\proj");
    expect(pty.spawned[0]!.env).toMatchObject({ KYLE_TERM_SESSION: "s1" });
    expect(terms[0]!.resets).toBe(0);
    expect(s.agent.claudeSessionId).toBe("sid-1");
    expect(s.agent.firstPrompt).toBe("hi");
    pty.listeners[0]!.onData("prompt>");
    vi.advanceTimersByTime(500);
    expect(pty.written).toEqual(["claude --resume sid-1\r"]);
  });

  it("Resume is unavailable without a stored id or for shells", () => {
    const m = makeManager();
    m.restore([...saved({ id: "n", claudeSessionId: undefined }), ...saved({ id: "sh", kind: "shell" })], () => undefined);
    expect(m.canResume(m.get("n")!)).toBe(false);
    expect(m.canResume(m.get("sh")!)).toBe(false);
    m.resume("n");
    expect(m.get("n")!.status).toBe("stopped");
  });

  it("Restart starts a fresh shell in the same folder and keeps history", () => {
    const m = makeManager();
    m.restore(saved({ kind: "shell", command: undefined }), () => "hist");
    m.restart("s1");
    expect(pty.spawned[0]!.cwd).toBe("C:\\proj");
    expect(m.get("s1")!.status).toBe("running");
    expect(terms[0]!.resets).toBe(0);
    expect(terms[0]!.out).toContain("hist");
  });

  it("falls back to the vault root with a notice when the folder is gone", () => {
    const m = makeManager();
    m.restore(saved(), () => undefined);
    existing = false;
    m.resume("s1");
    expect(pty.spawned[0]!.cwd).toBe("C:\\vault");
    expect(notices).toHaveLength(1);
  });

  it("takeScrollback only returns changed sessions (or forced running ones)", () => {
    const m = makeManager();
    const s = m.create({ kind: "shell", profileId: "powershell", cwd: "C:\\v" });
    expect(m.takeScrollback(s.id, 100)).toBeUndefined();
    pty.listeners[0]!.onData("x");
    expect(m.takeScrollback(s.id, 100)).toBe("SER");
    expect(m.takeScrollback(s.id, 100)).toBeUndefined();
    expect(m.takeScrollback(s.id, 100, true)).toBe("SER");
    m.restore(saved(), () => "h");
    expect(m.takeScrollback("s1", 100, true)).toBeUndefined();
  });

  it("close notifies so the scrollback file can be removed", () => {
    const closed: string[] = [];
    const m = new SessionManager({
      pty: new MockPty(), profiles: () => PROFILES, makeTerm: (h) => new MockTerm(h), onClosed: (id) => closed.push(id),
    });
    m.restore(saved(), () => undefined);
    m.close("s1");
    expect(closed).toEqual(["s1"]);
  });
});
