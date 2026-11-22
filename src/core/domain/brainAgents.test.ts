import { describe, expect, it } from "vitest";
import type { BrainAccessEvent } from "../events";
import {
  AGENT_FADE_MS, AGENT_IDLE_MS, agentAlpha, applyAccess, endSession, hashColor, lighten, pruneAgents, sessionName, startSession, tethers,
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
    expect(agents.get("free-9f9f1234")!.color).toBe(hashColor("free-9f9f1234"));
    expect(agents.get("sub-a")!.name).toBe("Build › Explore");
    expect(agents.get("sub-a")!.color).toBe(lighten("#e08a2c"));
    expect(agents.get("sub-b")!.name).toBe("Docs › Plan");
    expect(tethers(agents, 1000)).toEqual([["sub-a", "s1"], ["sub-b", "s2"]]);
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

  it("fades after 2 minutes idle, is pruned after the fade, and tethers drop when either side is idle", () => {
    const a = run([ev({ sessionId: "s1" }), ev({ sessionId: "sub", parentSessionId: "s1" })], 0);
    expect(agentAlpha(a.get("s1")!, AGENT_IDLE_MS)).toBe(1);
    expect(agentAlpha(a.get("s1")!, AGENT_IDLE_MS + AGENT_FADE_MS / 2)).toBeCloseTo(0.5);
    expect(pruneAgents(a, AGENT_IDLE_MS)).toBe(a);
    expect(tethers(a, AGENT_IDLE_MS + 1)).toEqual([]);
    expect(pruneAgents(a, AGENT_IDLE_MS + AGENT_FADE_MS).size).toBe(0);
    const b = applyAccess(a, ev({ sessionId: "sub", parentSessionId: "s1" }), 100_000, lookup);
    expect(pruneAgents(b, AGENT_IDLE_MS + AGENT_FADE_MS).size).toBe(2);
  });
});
