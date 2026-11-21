import { describe, expect, it, vi } from "vitest";
import type { HubEvents } from "../../../core";
import { AttentionTracker, StallDetector } from "../run/attention";
import { parseRunId, RunRegistry, type RunInfo } from "../run/runs";
import type { EndResult } from "../run/sessionEnd";
import { RunWatcher } from "../run/watcher";

const RUN: RunInfo = { ticketId: "LOCK-9", runId: "r-20261121-100000-LOCK-9", sessionId: "s1", startedAt: 0, worktree: "/wt" };
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(result: EndResult | undefined = { outcome: "partial", summary: "mechanical", costUsd: 0, needsAttention: "no agent summary" }) {
  let now = 1_000_000;
  const events: [string, unknown][] = [];
  const emit = ((e: string, p: unknown) => void events.push([e, p])) as <K extends keyof HubEvents>(e: K, p: HubEvents[K]) => void;
  const registry = new RunRegistry();
  registry.register(RUN);
  const tracker = new AttentionTracker(emit, () => now);
  const stall = new StallDetector(() => now, () => 10_000);
  const finish = vi.fn(async () => result);
  const w = new RunWatcher({ registry, tracker, stall, finish, emit });
  return { w, tracker, events, finish, advance: (ms: number) => void (now += ms) };
}

const attn = (events: [string, unknown][]) => events.filter(([e]) => e === "session:needs-attention").map(([, p]) => p);

describe("needs-attention", () => {
  it("permission prompt emits needs-attention and clears on the next working state", () => {
    const { w, tracker, events } = setup();
    w.onState("s1", "needs-input");
    expect(attn(events)).toEqual([{ sessionId: "s1", ticketId: "LOCK-9", runId: RUN.runId, reason: "needs-input" }]);
    expect(tracker.forTicket("LOCK-9")?.reason).toBe("needs-input");
    w.onState("s1", "working");
    expect(tracker.forTicket("LOCK-9")).toBeUndefined();
    expect(events.some(([e]) => e === "session:attention-cleared")).toBe(true);
  });

  it("stall: silent working session raises stalled; a hook event clears it", () => {
    const { w, tracker, events, advance } = setup();
    w.onState("s1", "working");
    advance(9_000);
    w.tick();
    expect(tracker.list()).toHaveLength(0);
    advance(2_000);
    w.tick();
    expect(attn(events)).toEqual([{ sessionId: "s1", ticketId: "LOCK-9", runId: RUN.runId, reason: "stalled" }]);
    w.tick();
    expect(attn(events)).toHaveLength(1);
    w.onHook("s1", "PostToolUse", {}, undefined);
    expect(tracker.list()).toHaveLength(0);
  });

  it("a finished (stopped) session is never reported stalled", () => {
    const { w, tracker, advance } = setup();
    w.onState("s1", "working");
    w.onHook("s1", "Stop", {}, undefined);
    advance(60_000);
    w.tick();
    expect(tracker.list()).toHaveLength(0);
  });

  it("ignores sessions that are not launched runs", () => {
    const { w, events } = setup();
    w.onState("other", "needs-input");
    expect(events).toHaveLength(0);
  });
});

describe("session end from the hook stream", () => {
  it("SessionEnd without summary raises no-summary attention once; process exit afterwards is ignored", async () => {
    const { w, tracker, events, finish } = setup();
    w.onHook("s1", "UserPromptSubmit", {}, { KH_RUN: RUN.runId });
    w.onHook("s1", "SessionEnd", { reason: "prompt_input_exit", session_id: "claude-1" }, { KH_RUN: RUN.runId });
    await tick();
    w.onExit("s1", 0);
    await tick();
    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith(RUN, { closedByUser: true, claudeSessionId: "claude-1" });
    expect(tracker.forTicket("LOCK-9")?.reason).toBe("no agent summary");
    expect(events.filter(([e]) => e === "run:finished")).toHaveLength(1);
    w.onTicketStatusChanged("LOCK-9");
    expect(tracker.forTicket("LOCK-9")).toBeUndefined();
  });

  it("summary present: run:finished and no attention", async () => {
    const { w, tracker, events } = setup({ outcome: "success", summary: "agent", costUsd: 1 });
    w.onHook("s1", "SessionEnd", { reason: "other" }, undefined);
    await tick();
    expect(tracker.list()).toHaveLength(0);
    expect(events.find(([e]) => e === "run:finished")?.[1]).toMatchObject({ outcome: "success", summary: "agent" });
  });

  it("SessionEnd for /clear does not end the run; process exit with a crash code does", async () => {
    const { w, finish } = setup();
    w.onHook("s1", "SessionEnd", { reason: "clear" }, undefined);
    await tick();
    expect(finish).not.toHaveBeenCalled();
    w.onExit("s1", 3);
    await tick();
    expect(finish).toHaveBeenCalledWith(RUN, { exitCode: 3, closedByUser: false });
  });
});

describe("run registry", () => {
  it("learns a run from hook env after a restart", () => {
    const r = new RunRegistry();
    const run = r.fromHook("s9", { KH_RUN: "r-20261121-100000-LOCK-9", KH_TICKET: "LOCK-9" }, "/wt");
    expect(run).toMatchObject({ ticketId: "LOCK-9", worktree: "/wt", startedAt: new Date(2026, 10, 21, 10, 0, 0).getTime() });
    expect(r.fromHook("s9", undefined, undefined)).toBe(run);
    expect(r.fromHook("s10", undefined, undefined)).toBeUndefined();
    expect(parseRunId("nope")).toBeUndefined();
  });
});
