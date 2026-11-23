import { describe, expect, it } from "vitest";
import type { BrainAccessEvent } from "../events";
import {
  SUBAGENT_IDLE_MS, applyAccess, endSession, hashColor, lighten, pruneAgents, sessionName, startSession, startSubagent, endSubagent, uniqueColor, zapOf,
  type Agents, type IdentityLookup,
} from "./brainAgents";

const lookup: IdentityLookup = (id) =>
  ({
    s1: { title: "Build", color: "#e08a2c", kind: "claude" as const },
    s2: { title: "Docs", color: "#a371f7", kind: "claude" as const },
    sh: { kind: "shell" as const },
  })[id as "s1"];
const ev = (o: Partial<BrainAccessEvent> & { sessionId: string }): BrainAccessEvent => ({ t: "", kind: "read", ...o });
const run = (events: BrainAccessEvent[], now = 1000): Agents => events.reduce<Agents>((a, e) => applyAccess(a, e, now, lookup), new Map());

describe("helpers", () => {
  it("hashColor is stable and avoids blue/green", () => {
    expect(hashColor("abc")).toBe(hashColor("abc"));
    for (let i = 0; i < 50; i++) expect(["#4c8dff", "#3fb950"]).not.toContain(hashColor(`x${i}`));
  });
  it("lighten mixes towards white", () => {
    expect(lighten("#000000", 0.5)).toBe("#808080");
    expect(lighten("red")).toBe("red");
  });
  it("names unpaned sessions folder·shortid", () => {
    expect(sessionName("abcd3f2a", { cwd: "C:/code/locked-away/" })).toBe("locked-away·3f2a");
    expect(sessionName("abcd3f2a", undefined)).toBe("claude·3f2a");
    expect(sessionName("s1", { title: " Build " })).toBe("Build");
  });
});

describe("agents reducer", () => {
  it("renders 3 sessions and 2 sub-agents with distinct colours and correct tethers", () => {
    const agents = run([
      ev({ sessionId: "s1", path: "a.md" }),
      ev({ sessionId: "s2", path: "b.md", kind: "write" }),
      ev({ sessionId: "free-9f9f1234", cwd: "C:/x/locked-away", path: "c.md" }),
      ev({ sessionId: "sub-a", parentSessionId: "s1", agentType: "Explore", path: "d.md" }),
      ev({ sessionId: "sub-b", parentSessionId: "s2", agentType: "Plan" }),
    ]);
    expect(agents.size).toBe(5);
    expect(new Set([...agents.values()].map((a) => a.color)).size).toBe(5);
    expect(agents.get("s1")!.name).toBe("Build");
    expect(agents.get("free-9f9f1234")!.name).toBe("locked-away·1234");
    expect(agents.get("free-9f9f1234")!.color).toBe(uniqueColor("free-9f9f1234", new Set(["#e08a2c", "#a371f7"])));
    expect(agents.get("sub-a")!.name).toBe("Build › Explore");
    expect(agents.get("sub-a")!.color).toBe(lighten("#e08a2c"));
    expect(agents.get("sub-b")!.name).toBe("Docs › Plan");
    const orbiters = [...agents.values()].filter((a) => !a.parentId), moons = [...agents.values()].filter((a) => a.parentId);
    expect([orbiters.length, moons.length]).toEqual([3, 2]);
    expect(moons.map((m) => [m.id, m.parentId])).toEqual([["sub-a", "s1"], ["sub-b", "s2"]]);
    expect(agents.get("s2")).toMatchObject({ note: "b.md", noteKind: "write", visits: 1 });
    expect(agents.get("sub-b")!.note).toBeUndefined();
  });

  it("creates the parent when only a sub-agent event arrives, and search keeps the last note", () => {
    const a = run([ev({ sessionId: "sub", parentSessionId: "s1", agentType: "Explore", path: "n.md" }), ev({ sessionId: "sub", parentSessionId: "s1", kind: "search", pattern: "x" })]);
    expect(a.has("s1")).toBe(true);
    expect(a.get("sub")).toMatchObject({ note: "n.md", visits: 1 });
  });

  it("start shows Claude sessions only; end removes the session and its sub-agents", () => {
    expect(startSession(new Map(), "sh", 5, lookup).size).toBe(0);
    expect(startSession(new Map(), "nobody", 5, lookup).size).toBe(0);
    let a = startSession(new Map(), "s1", 5, lookup);
    expect(a.has("s1")).toBe(true);
    a = applyAccess(a, ev({ sessionId: "sub", parentSessionId: "s1" }), 6, lookup);
    a = applyAccess(a, ev({ sessionId: "s2" }), 6, lookup);
    a = endSession(a, "s1");
    expect([...a.keys()]).toEqual(["s2"]);
    expect(endSession(a, "gone")).toBe(a);
  });

  it("keeps a session idle for an hour; only the safety fallback drops a silent moon", () => {
    const a = run([ev({ sessionId: "s1" }), ev({ sessionId: "sub", parentSessionId: "s1" })], 0);
    const hour = 60 * 60_000;
    expect([...pruneAgents(a, hour).keys()]).toEqual(["s1"]);
    expect(pruneAgents(a, SUBAGENT_IDLE_MS)).toBe(a);
    const b = applyAccess(a, ev({ sessionId: "sub", parentSessionId: "s1" }), hour - 1000, lookup);
    expect(pruneAgents(b, hour).size).toBe(2);
  });

  it("a moon persists across 5 minutes of silence, with the same slot", () => {
    let a = startSubagent(new Map(), "s1", "sub", "Explore", 0, lookup);
    const slot = a.get("sub")!.slot;
    expect(a.get("sub")).toMatchObject({ parentId: "s1", name: "Build › Explore" });
    a = pruneAgents(a, 5 * 60_000);
    expect(a.has("sub")).toBe(true);
    a = applyAccess(a, ev({ sessionId: "sub", parentSessionId: "s1", path: "n.md" }), 5 * 60_000, lookup);
    expect(a.get("sub")!.slot).toBe(slot);
  });

  it("subagent:ended removes only that moon; parent end removes all its moons", () => {
    let a = startSubagent(new Map(), "s1", "m1", "Explore", 0, lookup);
    a = startSubagent(a, "s1", "m2", "Plan", 0, lookup);
    expect(endSubagent(a, "s1")).toBe(a);
    expect(endSubagent(a, "nope")).toBe(a);
    const b = endSubagent(a, "m1");
    expect([...b.keys()].sort()).toEqual(["m2", "s1"]);
    expect(endSession(a, "s1").size).toBe(0);
  });

  it("drops orphaned sub-agents", () => {
    const a = run([ev({ sessionId: "sub", parentSessionId: "s1" })]);
    const orphan = new Map(a);
    orphan.delete("s1");
    expect(pruneAgents(orphan, 1000).size).toBe(0);
  });

  it("assigns stable, reusable orbit slots and unique colours among live sessions", () => {
    const ids = ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"];
    let a: Agents = new Map();
    for (const id of ids) a = applyAccess(a, ev({ sessionId: id }), 1, lookup);
    expect(ids.map((id) => a.get(id)!.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(ids.map((id) => a.get(id)!.color)).size).toBe(8);
    a = applyAccess(a, ev({ sessionId: "u3", path: "x.md" }), 5, lookup);
    expect(a.get("u3")!.slot).toBe(2);
    a = endSession(a, "u2");
    a = applyAccess(a, ev({ sessionId: "u9" }), 6, lookup);
    expect(a.get("u9")!.slot).toBe(1);
    expect(a.get("u4")!.slot).toBe(3);
  });

  it("synthetic stream: zap targets are the notes, and everything is removed on end", () => {
    const stream = [
      ev({ sessionId: "s1", path: "a.md" }),
      ev({ sessionId: "s2", path: "b.md", kind: "write" }),
      ev({ sessionId: "free-1", path: "c.md" }),
      ev({ sessionId: "sub-a", parentSessionId: "s1", path: "d.md" }),
      ev({ sessionId: "sub-b", parentSessionId: "s2", kind: "search", pattern: "x" }),
    ];
    expect(stream.map((e) => zapOf(e))).toEqual([
      { agentId: "s1", path: "a.md", kind: "read" },
      { agentId: "s2", path: "b.md", kind: "write" },
      { agentId: "free-1", path: "c.md", kind: "read" },
      { agentId: "sub-a", path: "d.md", kind: "read" },
      undefined,
    ]);
    let a = run(stream);
    expect(a.size).toBe(5);
    for (const id of ["s1", "s2", "free-1"]) a = endSession(a, id);
    expect(a.size).toBe(0);
  });

  it("numbers moons per parent", () => {
    const a = run([
      ev({ sessionId: "m1", parentSessionId: "s1" }),
      ev({ sessionId: "m2", parentSessionId: "s1" }),
      ev({ sessionId: "m3", parentSessionId: "s2" }),
    ]);
    expect([a.get("m1")!.slot, a.get("m2")!.slot, a.get("m3")!.slot]).toEqual([0, 1, 0]);
  });
});
