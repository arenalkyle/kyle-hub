import { describe, expect, it } from "vitest";
import { describeTool, initialAgent, reduceAgent, runningCount, SUBAGENT_FADE_MS, type AgentEvent, type AgentInfo } from "../src/agent-state";

const hook = (event: string, payload: Record<string, unknown> = {}, at = 1000): AgentEvent => ({ type: "hook", event, payload, at });
const run = (events: AgentEvent[], from: AgentInfo = initialAgent()): AgentInfo => events.reduce(reduceAgent, from);

describe("state transitions", () => {
  it("idle -> working -> needs-input -> working -> finished", () => {
    let i = initialAgent();
    expect(i.state).toBe("idle");
    i = reduceAgent(i, hook("UserPromptSubmit", { prompt: "do it" }));
    expect(i.state).toBe("working");
    i = reduceAgent(i, hook("Notification", { message: "Claude needs your permission to use Bash" }));
    expect(i.state).toBe("needs-input");
    expect(i.activity).toContain("permission");
    i = reduceAgent(i, hook("PreToolUse", { tool_name: "Read", tool_input: { file_path: "C:\\r\\PLAN.md" } }));
    expect(i.state).toBe("working");
    i = reduceAgent(i, hook("Notification", {}));
    i = reduceAgent(i, hook("UserPromptSubmit", { prompt: "again" }));
    expect(i.state).toBe("working");
    i = reduceAgent(i, hook("Stop"));
    expect(i.state).toBe("finished");
    expect(i.activity).toBeUndefined();
  });
  it("PostToolUse returns to working after an approved permission", () => {
    expect(run([hook("Notification"), hook("PostToolUse")]).state).toBe("working");
  });
  it("viewed clears needs-input and finished, but not working", () => {
    expect(run([hook("Stop"), { type: "viewed" }]).state).toBe("idle");
    expect(run([hook("Notification"), { type: "viewed" }]).state).toBe("idle");
    expect(run([hook("UserPromptSubmit"), { type: "viewed" }]).state).toBe("working");
  });
  it("exit overrides everything and is terminal", () => {
    const i = run([hook("UserPromptSubmit"), { type: "exit" }, hook("Stop"), { type: "bell" }]);
    expect(i.state).toBe("exited");
  });
  it("SessionStart stores the claude session id without changing state", () => {
    const i = run([hook("SessionStart", { session_id: "abc-123", source: "startup" })]);
    expect(i.claudeSessionId).toBe("abc-123");
    expect(i.state).toBe("idle");
    expect(i.hasHookEvents).toBe(true);
  });
  it("keeps the first prompt only", () => {
    const i = run([hook("UserPromptSubmit", { prompt: "first" }), hook("UserPromptSubmit", { prompt: "second" })]);
    expect(i.firstPrompt).toBe("first");
  });
  it("does not mutate its input", () => {
    const a = initialAgent();
    reduceAgent(a, hook("UserPromptSubmit", { prompt: "x" }));
    expect(a).toEqual(initialAgent());
  });
});

describe("bell/idle fallback", () => {
  it("bell -> needs-input, output -> working, idle -> finished (never-hooked only)", () => {
    expect(run([{ type: "bell" }]).state).toBe("needs-input");
    expect(run([{ type: "output" }]).state).toBe("working");
    expect(run([{ type: "output" }, { type: "idle" }]).state).toBe("finished");
    expect(run([{ type: "bell" }, { type: "output" }]).state).toBe("needs-input");
  });
  it("is ignored once a hook event has been received", () => {
    const hooked = run([hook("SessionStart", { session_id: "s" })]);
    expect(run([{ type: "bell" }, { type: "output" }, { type: "idle" }], hooked).state).toBe("idle");
    const working = run([hook("UserPromptSubmit")]);
    expect(run([{ type: "idle" }], working).state).toBe("working");
  });
});

describe("sub-agents", () => {
  const task = (d: string, t = "general-purpose") => hook("PreToolUse", { tool_name: "Task", tool_input: { description: d, subagent_type: t } });
  it("without ids: matched in order; count equals running", () => {
    let i = run([task("one"), task("two")]);
    expect(runningCount(i)).toBe(2);
    i = reduceAgent(i, hook("SubagentStop", {}, 2000));
    expect(runningCount(i)).toBe(1);
    expect(i.subAgents[0]).toMatchObject({ description: "one", status: "done", endedAt: 2000 });
    i = reduceAgent(i, hook("SubagentStop", {}, 2100));
    expect(runningCount(i)).toBe(0);
  });
  it("SubagentStart adopts the pending Task entry and tracks by id", () => {
    let i = run([task("one"), hook("SubagentStart", { agent_id: "A", agent_type: "Explore" })]);
    expect(i.subAgents).toHaveLength(1);
    expect(i.subAgents[0]).toMatchObject({ id: "A", type: "Explore", description: "one" });
    i = run([task("two"), hook("SubagentStart", { agent_id: "B" })], i);
    expect(runningCount(i)).toBe(2);
    i = reduceAgent(i, hook("SubagentStop", { agent_id: "B" }, 3000));
    expect(i.subAgents.find((a) => a.id === "B")?.status).toBe("done");
    expect(i.subAgents.find((a) => a.id === "A")?.status).toBe("running");
  });
  it("SubagentStart without a preceding Task adds an entry", () => {
    const i = run([hook("SubagentStart", { agent_id: "Z", agent_type: "Plan" })]);
    expect(i.subAgents).toEqual([{ id: "Z", type: "Plan", status: "running" }]);
  });
  it("Stop closes leftover id-less entries; finished entries are pruned after the fade", () => {
    let i = run([task("one"), hook("Stop", {}, 2000)]);
    expect(runningCount(i)).toBe(0);
    i = reduceAgent(i, hook("UserPromptSubmit", {}, 2000 + SUBAGENT_FADE_MS + 1));
    expect(i.subAgents).toHaveLength(0);
  });
});

describe("describeTool", () => {
  it("maps common tools to readable phrases", () => {
    expect(describeTool("Edit", { file_path: "C:\\r\\src\\view.ts" }, "C:\\r")).toBe("Editing src/view.ts");
    expect(describeTool("Write", { file_path: "/x/y/z.md" })).toBe("Editing z.md");
    expect(describeTool("Bash", { command: "npm test" })).toBe("Running npm test");
    expect(describeTool("Read", { file_path: "/a/PLAN.md" })).toBe("Reading PLAN.md");
    expect(describeTool("Grep", { pattern: "hook" })).toBe("Searching for 'hook'");
    expect(describeTool("Glob", {})).toBe("Searching…");
    expect(describeTool("Agent", { description: "audit" })).toBe("Starting sub-agent: audit");
    expect(describeTool("WebFetch", {})).toBe("WebFetch");
  });
});
