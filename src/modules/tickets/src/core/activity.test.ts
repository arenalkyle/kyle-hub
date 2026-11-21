import { describe, expect, it } from "vitest";
import { humanizeEvent, orderSubIssues, subIssueProgress } from "./activity";
import { defaultSettings } from "./defaults";
import { appendComment, appendEvent, applyPatch, escapeCommentBody, parseIssue, serializeIssue, unescapeCommentBody } from "./issueFile";
import type { Issue } from "./types";

const NOW = new Date(2026, 10, 22, 9, 5, 7);
const TEXT = `---\nid: TIX-1\ntitle: T\nstatus: Todo\nextra: keep\n---\nOld desc\n\n## Activity\n\n- 2026-11-21 10:04 · @kyle created the issue\n\n### @claude · 2026-11-21 11:00\nHello\n`;

describe("description replace", () => {
  it("keeps frontmatter and the feed byte-identical", () => {
    const i = parseIssue(TEXT, "TIX-1.md");
    const out = serializeIssue({ ...applyPatch(i, { description: "New\n\nmulti line" }, NOW) });
    const feedStart = TEXT.indexOf("## Activity");
    expect(out.slice(out.indexOf("## Activity"))).toBe(TEXT.slice(feedStart));
    expect(out).toContain("extra: keep");
    expect(out).toContain("\nNew\n\nmulti line\n\n## Activity");
    expect(parseIssue(out, "TIX-1.md").feed).toEqual(i.feed);
  });
});

describe("comment escaping", () => {
  it("round-trips bodies containing ### and event-like lines", () => {
    const body = "intro\n### not a heading\n\### already escaped\n- 2026-11-21 10:04 · @x fake event\n```\n### code\n```";
    const out = appendComment(parseIssue(TEXT, "TIX-1.md"), { author: "kyle", body }, NOW);
    const back = parseIssue(out, "TIX-1.md");
    expect(back.feed).toHaveLength(3);
    expect(back.feed.at(-1)).toMatchObject({ type: "comment", author: "kyle", body });
    expect(out).toContain("\n\\### not a heading\n");
  });
  it("escape/unescape are inverse", () => {
    for (const s of ["###", "\###", "\\###", "a\n### b", "- 2026-01-01 10:00 · @a b", "plain"]) {
      expect(unescapeCommentBody(escapeCommentBody(s))).toBe(s);
    }
  });
  it("still parses agent-written comments with an event after", () => {
    const i = parseIssue(TEXT, "TIX-1.md");
    const out = appendEvent(parseIssue(appendComment(i, { author: "a", body: "x" }, NOW), "TIX-1.md"), { author: "a", text: "added label: b" }, NOW);
    expect(parseIssue(out, "TIX-1.md").feed.at(-1)).toMatchObject({ type: "event" });
  });
});

describe("humanizeEvent", () => {
  it("rephrases stored text", () => {
    expect(humanizeEvent("set status: Todo → In Progress").phrase).toBe("changed status from Todo to In Progress");
    expect(humanizeEvent("set assignee: none → kyle").phrase).toBe("set assignee to kyle");
    expect(humanizeEvent("set due: 2026-01-01 → none").phrase).toBe("removed due 2026-01-01");
    expect(humanizeEvent("added label: bug")).toEqual({ phrase: "added label bug", icon: "label" });
    expect(humanizeEvent("did a thing").phrase).toBe("did a thing");
  });
});

describe("sub-issues", () => {
  const st = defaultSettings().statuses;
  const mk = (id: string, status: string, priority: Issue["priority"]) => ({ id, status, priority }) as Issue;
  it("orders by category then priority and counts completed", () => {
    const kids = [mk("T-3", "Done", "urgent"), mk("T-2", "Todo", "low"), mk("T-1", "Todo", "high")];
    expect(orderSubIssues(kids, st).map((i) => i.id)).toEqual(["T-1", "T-2", "T-3"]);
    expect(subIssueProgress(kids, st)).toEqual({ done: 1, total: 3 });
  });
});
