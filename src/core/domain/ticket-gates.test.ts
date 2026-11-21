import { describe, expect, it } from "vitest";
import { buildIssueText } from "./create";
import { effectiveRepo, effectiveType, parseCost, parseSource, parseType } from "./fields";
import { parseAcceptance, tickAcceptance } from "./acceptance";
import { fingerprintOf, normalizeTitle } from "./fingerprint";
import { agentNewStatus, agentSource, checkAgentLabels, checkAgentStatus, isAgentMode } from "./gates";
import { DEFAULT_FLOOD, checkCaps, expiredTriage, findDuplicate } from "./flood";
import { isQueued } from "./queue";
import { planAgentCreate } from "./agentCreate";
import { parseIssue, serializeIssue, applyPatch } from "./issueFile";
import type { Issue, StatusDef } from "./types";

const STATUSES: StatusDef[] = [
  { name: "Triage", category: "triage", color: "", order: 0 },
  { name: "Backlog", category: "backlog", color: "", order: 1 },
  { name: "Todo", category: "unstarted", color: "", order: 2 },
  { name: "In Progress", category: "started", color: "", order: 3 },
  { name: "Done", category: "completed", color: "", order: 4 },
  { name: "Canceled", category: "canceled", color: "", order: 5 },
];

const NOW = new Date(2026, 10, 21, 12, 0, 0);

function make(id: string, title: string, extra = "", now = NOW): Issue {
  const text = buildIssueText(id, { title, tags: [] }, "Triage", now);
  const withExtra = extra === "" ? text : text.replace(/^---\n/, `---\n${extra}\n`);
  return parseIssue(withExtra, `${id}.md`);
}

describe("fields", () => {
  it("parses enum fields and rejects unknown values", () => {
    expect(parseType("Bug")).toBe("bug");
    expect(parseType("epic")).toBeUndefined();
    expect(parseSource("agent:run-1")).toBe("agent:run-1");
    expect(parseSource("robot")).toBeUndefined();
    expect(parseCost("1.25")).toBe(1.25);
    expect(parseCost("nope")).toBeUndefined();
  });

  it("round-trips new fields and preserves unknown keys; old tickets stay byte-identical", () => {
    const old = buildIssueText("TIX-1", { title: "Old" }, "Backlog", NOW);
    const oldIssue = parseIssue(old, "TIX-1.md");
    expect(serializeIssue(oldIssue)).toBe(old);

    const text = old.replace(/^---\n/, "---\nmystery: keep-me\ntype: proposal\nblockedBy:\n  - TIX-2\nmodel: sonnet\ncostUsd: 0.5\nsource: agent:s1\nfingerprint: abc123def456\n");
    const parsed = parseIssue(text, "TIX-1.md");
    expect(parsed.type).toBe("proposal");
    expect(parsed.blockedBy).toEqual(["TIX-2"]);
    expect(parsed.model).toBe("sonnet");
    expect(parsed.costUsd).toBe(0.5);
    expect(parsed.source).toBe("agent:s1");
    expect(parsed.fingerprint).toBe("abc123def456");
    expect(serializeIssue(parsed)).toBe(text);
    expect(serializeIssue(parsed)).toContain("mystery: keep-me");
  });

  it("applies the task default and effective repo inheritance", () => {
    expect(effectiveType(make("TIX-1", "x"))).toBe("task");
    expect(effectiveRepo({ repo: "a" }, { repo: "b" })).toBe("a");
    expect(effectiveRepo({}, { repo: "b" })).toBe("b");
    expect(effectiveRepo({})).toBeUndefined();
  });

  it("applyPatch sets and clears the new fields", () => {
    const i = applyPatch(make("TIX-1", "x"), { type: "bug", repo: "kyle-hub" }, NOW);
    expect(i.type).toBe("bug");
    expect(effectiveRepo(i)).toBe("kyle-hub");
    expect(applyPatch(i, { repo: null }, NOW).repo).toBeUndefined();
  });
});

describe("acceptance criteria", () => {
  const body = [
    "## Acceptance criteria",
    "- [ ] first",
    "- [x] second",
    "  - [ ] nested ignored",
    "",
    "## Notes",
    "- [ ] not a criterion",
  ].join("\n");

  it("reports none, partial and all-checked", () => {
    expect(parseAcceptance("no section")).toEqual({ total: 0, checked: 0, items: [] });
    expect(parseAcceptance(body)).toEqual({
      total: 2,
      checked: 1,
      items: [
        { index: 0, text: "first", checked: false },
        { index: 1, text: "second", checked: true },
      ],
    });
    const all = tickAcceptance(tickAcceptance(body, 0), 1);
    expect(parseAcceptance(all).checked).toBe(2);
  });

  it("ticks an item by index and throws when out of range", () => {
    const next = tickAcceptance(body, 0);
    expect(next).toContain("- [x] first");
    expect(next).toContain("  - [ ] nested ignored");
    expect(() => tickAcceptance(body, 5)).toThrow(RangeError);
  });
});

describe("fingerprint", () => {
  it("normalizes case, whitespace, punctuation, ids and numbers", () => {
    expect(normalizeTitle("  Fix  the Login!! LOCK-47 (v2)  ")).toBe("fix the login v");
    expect(fingerprintOf({ type: "task", repo: "r", title: "Fix login 1" })).toBe(
      fingerprintOf({ type: "task", repo: "r", title: "fix   LOGIN 2!" }),
    );
  });

  it("differs by type and repo and is 12 hex chars", () => {
    const base = fingerprintOf({ type: "task", repo: "r", title: "x" });
    expect(base).toMatch(/^[0-9a-f]{12}$/);
    expect(fingerprintOf({ type: "bug", repo: "r", title: "x" })).not.toBe(base);
    expect(fingerprintOf({ type: "task", repo: "s", title: "x" })).not.toBe(base);
  });
});

describe("agent gates", () => {
  it("agent mode from flag, KH_AGENT or KH_RUN only", () => {
    expect(isAgentMode({})).toBe(false);
    expect(isAgentMode({}, true)).toBe(true);
    expect(isAgentMode({ KH_AGENT: "1" })).toBe(true);
    expect(isAgentMode({ KH_RUN: "r1" })).toBe(true);
    expect(agentSource({ KH_RUN: "r1" })).toBe("agent:r1");
    expect(agentSource({}, "s9")).toBe("agent:s9");
  });

  it("forces triage status, refuses agent-ready and completed", () => {
    expect(agentNewStatus(STATUSES)).toEqual({ ok: true, status: "Triage" });
    expect(checkAgentLabels(["bug", "agent-ready"]).ok).toBe(false);
    expect(checkAgentLabels(["bug"]).ok).toBe(true);
    expect(checkAgentStatus("Done", STATUSES).ok).toBe(false);
    expect(checkAgentStatus("In Progress", STATUSES).ok).toBe(true);
  });

  it("plans agent creation: forced status, source and fingerprint", () => {
    const plan = planAgentCreate({ title: "Refactor x" }, { statuses: STATUSES, issues: [], source: "agent:r1", flood: DEFAULT_FLOOD });
    expect(plan).toMatchObject({ ok: true, status: "Triage", source: "agent:r1" });
    const refused = planAgentCreate({ title: "x", tags: ["agent-ready"] }, { statuses: STATUSES, issues: [], source: "agent:r1", flood: DEFAULT_FLOOD });
    expect(refused.ok).toBe(false);
  });
});

describe("flood controls", () => {
  it("dedupes open tickets by fingerprint, ignoring closed ones", () => {
    const fp = "aaaaaaaaaaaa";
    const open = make("TIX-1", "a", `fingerprint: ${fp}`);
    const done = make("TIX-2", "b", `fingerprint: ${fp}`);
    done.status = "Done";
    expect(findDuplicate([open], STATUSES, fp)?.id).toBe("TIX-1");
    expect(findDuplicate([done], STATUSES, fp)).toBeUndefined();
  });

  it("caps tickets per run (exit 3) and open triage total", () => {
    const runIssues = Array.from({ length: 5 }, (_, n) => make(`TIX-${n + 1}`, `t${n}`, "source: agent:r1"));
    const perRun = checkCaps(runIssues, STATUSES, "agent:r1");
    expect(perRun).toMatchObject({ ok: false, exitCode: 3 });
    expect(checkCaps(runIssues, STATUSES, "agent:r2").ok).toBe(true);

    const many = Array.from({ length: 25 }, (_, n) => make(`TIX-${n + 1}`, `u${n}`));
    expect(checkCaps(many, STATUSES, "agent:new")).toMatchObject({ ok: false, exitCode: 3 });
    expect(checkCaps(many.slice(1), STATUSES, "agent:new").ok).toBe(true);
  });

  it("expires triage tickets untouched for 14 days using a fake clock", () => {
    const old = new Date(NOW.getTime() - 15 * 24 * 60 * 60 * 1000);
    const stale = make("TIX-1", "old", "", old);
    const fresh = make("TIX-2", "new", "", NOW);
    const backlog = make("TIX-3", "bl", "", old);
    backlog.status = "Backlog";
    const hits = expiredTriage([stale, fresh, backlog], STATUSES, NOW, 14).map((i) => i.id);
    expect(hits).toEqual(["TIX-1"]);
  });
});

describe("isQueued", () => {
  const blocker = (status: string): Issue => {
    const i = make("TIX-9", "blocker");
    i.status = status;
    return i;
  };
  const ready = (blockedBy: string[], status = "Todo"): Issue => {
    const i = make("TIX-1", "ready");
    i.tags = ["agent-ready"];
    i.status = status;
    i.blockedBy = blockedBy;
    return i;
  };

  it("requires agent-ready, unstarted status and completed blockers", () => {
    expect(isQueued(ready([]), [], STATUSES)).toBe(true);
    expect(isQueued({ ...ready([]), tags: [] }, [], STATUSES)).toBe(false);
    expect(isQueued(ready([], "In Progress"), [], STATUSES)).toBe(false);
    expect(isQueued(ready(["TIX-9"]), [blocker("Todo")], STATUSES)).toBe(false);
    expect(isQueued(ready(["TIX-9"]), [blocker("Done")], STATUSES)).toBe(true);
    expect(isQueued(ready(["TIX-404"]), [], STATUSES)).toBe(false);
  });
});
