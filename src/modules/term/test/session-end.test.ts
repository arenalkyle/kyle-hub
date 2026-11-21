import { describe, expect, it, vi } from "vitest";
import type { Issue, StatusDef } from "../../../core/domain/types";
import type { RunIndexEntry } from "../../../core/logs/types";
import type { GitPort } from "../launch/launch";
import { mechanicalSummary } from "../run/mechanical";
import type { RunInfo } from "../run/runs";
import { computeOutcome, finishRun, findAgentSummary, sumRunCost, type EndDeps } from "../run/sessionEnd";

const STATUSES: StatusDef[] = [
  { name: "Todo", category: "unstarted", color: "", order: 1 },
  { name: "In Progress", category: "started", color: "", order: 2 },
  { name: "In Review", category: "started", color: "", order: 3 },
  { name: "Done", category: "completed", color: "", order: 4 },
];

const START = new Date(2026, 10, 21, 10, 0, 0).getTime();
const RUN: RunInfo = { ticketId: "LOCK-9", runId: "r-20261121-100000-LOCK-9", sessionId: "s1", startedAt: START, worktree: "/wt", base: "base1" };

const DESC = "Do it.\n\n## Acceptance criteria\n\n- [x] one\n- [ ] two\n- [ ] three";
const ALL = "Do it.\n\n## Acceptance criteria\n\n- [x] one\n- [x] two";

const comment = (author: string, time: string): Issue["feed"][number] => ({ type: "comment", author, time, body: "done", id: "c1" });

const ticket = (over: Partial<Issue> = {}): Issue =>
  ({ id: "LOCK-9", title: "T", status: "In Progress", tags: [], description: DESC, feed: [], runs: [RUN.runId], ...over }) as unknown as Issue;

interface Opts {
  ticket?: Issue;
  commits?: string[];
  stat?: string;
  index?: Partial<RunIndexEntry>[];
  now?: number;
}

function setup(o: Opts = {}) {
  const t = o.ticket ?? ticket();
  const calls = { comment: [] as [string, string, unknown][], update: [] as [string, Record<string, unknown>, unknown][], events: [] as string[], annotate: [] as unknown[], ingest: [] as unknown[] };
  const git: GitPort = {
    run: async (args) => {
      if (args[0] === "log") return (o.commits ?? []).join("\n");
      if (args[0] === "diff") return o.stat ?? "";
      throw new Error("unexpected git " + args.join(" "));
    },
  };
  const deps: EndDeps = {
    tickets: {
      get: () => t,
      statuses: () => STATUSES,
      comment: vi.fn(async (id: string, body: string, actor?: unknown) => { calls.comment.push([id, body, actor]); return t; }),
      update: vi.fn(async (id: string, patch: Record<string, unknown>, actor?: unknown) => { calls.update.push([id, patch, actor]); return t; }),
      logEvent: vi.fn(async (_id: string, text: string) => { calls.events.push(text); return t; }),
    },
    logs: {
      ingest: vi.fn(async (x?: unknown) => { calls.ingest.push(x); return {}; }),
      runs: async () => (o.index ?? [{ runId: RUN.runId, costUsd: 1.5, durationMs: 600_000 }]) as RunIndexEntry[],
      annotateRun: vi.fn(async (_id: string, meta: unknown) => { calls.annotate.push(meta); }),
    },
    git,
    clock: () => new Date(o.now ?? START + 10 * 60_000),
  };
  return { deps, calls };
}

describe("agent summary detection", () => {
  it("counts only an agent comment from this run inside the window", () => {
    const end = START + 600_000;
    const t = (feed: Issue["feed"]) => findAgentSummary(ticket({ feed }), RUN, end);
    expect(t([comment(`agent:${RUN.runId}`, "2026-11-21 10:05")])).toBeDefined();
    expect(t([comment("kyle-hub", "2026-11-21 10:05")])).toBeUndefined();
    expect(t([comment("kyle", "2026-11-21 10:05")])).toBeUndefined();
    expect(t([comment("agent:r-other", "2026-11-21 10:05")])).toBeUndefined();
    expect(t([comment(`agent:${RUN.runId}`, "2026-11-21 09:30")])).toBeUndefined();
    expect(t([comment(`agent:${RUN.runId}`, "2026-11-21 11:30")])).toBeUndefined();
  });
});

describe("finishRun", () => {
  it("summary present: In Review, event, outcome partial with unticked criteria", async () => {
    const { deps, calls } = setup({ ticket: ticket({ feed: [comment(`agent:${RUN.runId}`, "2026-11-21 10:08")] }), commits: ["feat: x"] });
    const r = await finishRun(deps, RUN, { exitCode: 0 });
    expect(r).toMatchObject({ outcome: "partial", summary: "agent", costUsd: 1.5 });
    expect(r?.needsAttention).toBeUndefined();
    expect(calls.comment).toHaveLength(0);
    expect(calls.update[0]![1]).toEqual({ outcome: "partial", costUsd: 1.5, status: "In Review" });
    expect(calls.events).toEqual([`run ${RUN.runId} finished`]);
    expect(calls.annotate).toEqual([{ outcome: "partial", summaryCommented: true }]);
    expect(calls.ingest).toEqual([{}]);
  });

  it("summary + all criteria ticked is success; ingest is limited to the Claude session", async () => {
    const { deps, calls } = setup({ ticket: ticket({ description: ALL, feed: [comment(`agent:${RUN.runId}`, "2026-11-21 10:08")] }), commits: ["a"] });
    expect((await finishRun(deps, RUN, { claudeSessionId: "c-1" }))?.outcome).toBe("success");
    expect(calls.ingest).toEqual([{ sessionId: "c-1" }]);
  });

  it("no summary: mechanical comment as kyle-hub, status kept, needs-attention", async () => {
    const { deps, calls } = setup({ commits: ["feat: x", "fix: y"], stat: " a.ts | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)" });
    const r = await finishRun(deps, RUN, { exitCode: 0 });
    expect(r).toMatchObject({ outcome: "partial", summary: "mechanical", needsAttention: "no agent summary" });
    expect(calls.comment).toHaveLength(1);
    expect(calls.comment[0]![2]).toEqual({ author: "kyle-hub" });
    expect(calls.comment[0]![1]).toContain("- Acceptance criteria ticked: 1/3");
    expect(calls.update[0]![1]).not.toHaveProperty("status");
    expect(calls.events).toHaveLength(0);
    expect(calls.annotate).toEqual([{ outcome: "partial", summaryCommented: false }]);
  });

  it("outcome cases", () => {
    const base = { hasSummary: false, criteria: { checked: 0, total: 2 }, commits: 0, durationMs: 60_000 };
    expect(computeOutcome({ ...base, hasSummary: true, criteria: { checked: 2, total: 2 } })).toBe("success");
    expect(computeOutcome({ ...base, hasSummary: true, criteria: { checked: 1, total: 2 } })).toBe("partial");
    expect(computeOutcome({ ...base, hasSummary: true, criteria: { checked: 0, total: 0 } })).toBe("success");
    expect(computeOutcome({ ...base, exitCode: 1, commits: 3 })).toBe("failed");
    expect(computeOutcome({ ...base, durationMs: 10 * 60_000 })).toBe("failed");
    expect(computeOutcome({ ...base, closedByUser: true })).toBe("abandoned");
    expect(computeOutcome({ ...base, closedByUser: true, durationMs: 3 * 60_000 })).toBe("failed");
    expect(computeOutcome({ ...base, closedByUser: true, commits: 1 })).toBe("partial");
    expect(computeOutcome({ ...base, commits: 1, exitCode: 0 })).toBe("partial");
  });

  it("closed within 2 minutes with no commits and no summary is abandoned", async () => {
    const { deps, calls } = setup({ now: START + 60_000 });
    expect((await finishRun(deps, RUN, { closedByUser: true }))?.outcome).toBe("abandoned");
    expect(calls.update[0]![1]).toMatchObject({ outcome: "abandoned" });
  });

  it("nonzero exit with no summary is failed", async () => {
    const { deps } = setup({ commits: ["x"] });
    expect((await finishRun(deps, RUN, { exitCode: 2 }))?.outcome).toBe("failed");
  });

  it("does not move a non-started ticket to review", async () => {
    const { deps, calls } = setup({ ticket: ticket({ status: "Done", feed: [comment(`agent:${RUN.runId}`, "2026-11-21 10:08")] }) });
    await finishRun(deps, RUN);
    expect(calls.update[0]![1]).not.toHaveProperty("status");
  });
});

describe("costUsd rollup", () => {
  it("sums the ticket's runs once each", async () => {
    const index = [
      { runId: "r1", costUsd: 1.25 },
      { runId: "r2", costUsd: 0.5 },
      { runId: "r2", costUsd: 0.5 },
      { runId: RUN.runId, costUsd: 2 },
    ];
    expect(sumRunCost(index)).toBe(3.75);
    const { deps, calls } = setup({ index });
    await finishRun(deps, RUN);
    expect(calls.update[0]![1]).toMatchObject({ costUsd: 3.75 });
  });
});

describe("mechanical summary", () => {
  it("golden format", () => {
    expect(
      mechanicalSummary({
        runId: "r-1",
        durationMs: 754_000,
        costUsd: 0.4231,
        diffStat: " src/a.ts | 3 ++-\n 1 file changed, 2 insertions(+), 1 deletion(-)\n",
        commits: ["feat: add a", "fix: b"],
        criteria: { checked: 2, total: 3 },
        exitCode: 1,
      }),
    ).toBe(
      [
        "Run r-1 ended without an agent summary. This is a mechanical summary written by kyle-hub.",
        "",
        "- Duration: 12m 34s",
        "- Cost: $0.42",
        "- Acceptance criteria ticked: 2/3",
        "- Exit code: 1",
        "",
        "Changes:",
        "```",
        " src/a.ts | 3 ++-",
        " 1 file changed, 2 insertions(+), 1 deletion(-)",
        "```",
        "",
        "Commits:",
        "- feat: add a",
        "- fix: b",
      ].join("\n"),
    );
  });

  it("handles no changes and no commits", () => {
    const s = mechanicalSummary({ runId: "r-2", durationMs: 5000, costUsd: 0, diffStat: "", commits: [], criteria: { checked: 0, total: 0 } });
    expect(s).toContain("- Duration: 5s");
    expect(s).toContain("No file changes.");
    expect(s).toContain("No commits.");
  });
});
