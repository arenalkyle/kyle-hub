import { describe, expect, it } from "vitest";
import { defaultSettings } from "./defaults";
import { formatId, nextId, parseId } from "./ids";
import { appendComment, appendEvent, applyPatch, parseIssue, serializeIssue } from "./issueFile";
import { fromLink, toLink } from "./links";
import { parseProject, serializeProject } from "./projectFile";

const ISSUE = `---
id: TIX-12
title: Fix login bug
aliases: [Fix login bug]
status: In Progress
priority: high
assignee: claude
project: "[[kyle-tickets]]"
x-custom:   {a: 1,   b: [2, 3]}   # keep my spacing
milestone: Phase 1
tags: [bug, frontend]
due: 2026-12-01
parent: "[[TIX-3]]"
pullRequests:
  - https://github.com/owner/repo/pull/4
created: 2026-11-21T10:04:00
updated: 2026-11-21T10:31:00
updatedBy: kyle
sortOrder: 1000
another_unknown: hello
---
Description in **Markdown**.

Second paragraph.

## Activity

- 2026-11-21 10:04 · @kyle created the issue
- 2026-11-21 10:20 - @kyle set status: Todo → In Progress
junk line that is not an entry
### @claude · 2026-11-21 10:31
Implemented the parser;
tests in \`core.test.ts\`.

- a bullet in the comment

- 2026-11-21 10:40 — @kyle after the comment
### not a comment heading
trailing junk
`;

const NOW = new Date(2026, 10, 22, 9, 5, 7);

describe("issue round-trip", () => {
  it("serializes an unedited file byte-for-byte", () => {
    expect(serializeIssue(parseIssue(ISSUE, "TIX-12.md"))).toBe(ISSUE);
  });

  it("round-trips CRLF files", () => {
    const crlf = ISSUE.replace(/\n/g, "\r\n");
    expect(serializeIssue(parseIssue(crlf, "TIX-12.md"))).toBe(crlf);
  });

  it("parses fields and feed", () => {
    const i = parseIssue(ISSUE, "TIX-12.md");
    expect(i).toMatchObject({
      id: "TIX-12",
      title: "Fix login bug",
      status: "In Progress",
      priority: "high",
      assignee: "claude",
      project: "[[kyle-tickets]]",
      milestone: "Phase 1",
      tags: ["bug", "frontend"],
      due: "2026-12-01",
      parent: "[[TIX-3]]",
      pullRequests: ["https://github.com/owner/repo/pull/4"],
      created: "2026-11-21T10:04:00",
      sortOrder: 1000,
    });
    expect(i.description).toBe("Description in **Markdown**.\n\nSecond paragraph.");
    expect(i.feed).toEqual([
      { type: "event", time: "2026-11-21 10:04", author: "kyle", text: "created the issue" },
      { type: "event", time: "2026-11-21 10:20", author: "kyle", text: "set status: Todo → In Progress" },
      {
        type: "comment", id: "L0",
        author: "claude",
        time: "2026-11-21 10:31",
        body: "Implemented the parser;\ntests in `core.test.ts`.\n\n- a bullet in the comment",
      },
      { type: "event", time: "2026-11-21 10:40", author: "kyle", text: "after the comment" },
    ]);
  });

  it("defaults missing fields and uses the file name for the id", () => {
    const i = parseIssue("---\ntitle: T\n---\nbody\n", "TIX-9.md");
    expect(i).toMatchObject({ id: "TIX-9", priority: "none", tags: [], feed: [] });
    expect(serializeIssue(i)).toBe("---\ntitle: T\n---\nbody\n");
  });
});

describe("applyPatch", () => {
  it("keeps unknown keys in place and only touches changed keys", () => {
    const i = parseIssue(ISSUE, "TIX-12.md");
    const out = serializeIssue(applyPatch(i, { status: "Done", due: null }, NOW));
    expect(out).toContain("status: Done\n");
    expect(out).not.toContain("due:");
    expect(out).toContain("updated: 2026-11-22T09:05:07\n");
    expect(out).toMatch(/x-custom:\s+\{ ?a: 1, b: \[ ?2, 3 ?\] ?\}\s+# keep my spacing\n/);
    expect(out.indexOf("x-custom")).toBeLessThan(out.indexOf("milestone"));
    expect(out.indexOf("another_unknown")).toBeGreaterThan(out.indexOf("sortOrder"));
    const tail = (t: string): string => t.slice(t.indexOf("\n---\n", 4));
    expect(tail(out)).toBe(tail(ISSUE));
  });

  it("title change updates aliases", () => {
    const i = parseIssue(ISSUE, "TIX-12.md");
    const p = applyPatch(i, { title: "Fix the login bug" }, NOW);
    expect(p.aliases).toEqual(["Fix the login bug"]);
    const out = serializeIssue(p);
    expect(out).toContain("title: Fix the login bug\n");
    expect(out).toContain("aliases: [Fix the login bug]\n");
    expect(parseIssue(out, "TIX-12.md").aliases).toEqual(["Fix the login bug"]);
  });

  it("keeps extra aliases and sets new fields", () => {
    const i = parseIssue("---\ntitle: A\naliases: [A, Other]\n---\n", "TIX-1.md");
    const p = applyPatch(i, { title: "B", project: toLink("Proj"), tags: ["x"], priority: "urgent" }, NOW);
    const out = serializeIssue(p);
    expect(out).toContain("aliases: [B, Other]");
    expect(out).toContain('project: "[[Proj]]"');
    expect(parseIssue(out, "TIX-1.md")).toMatchObject({ priority: "urgent", tags: ["x"] });
  });

  it("rewrites the description without touching the feed", () => {
    const i = parseIssue(ISSUE, "TIX-12.md");
    const out = serializeIssue(applyPatch(i, { description: "New text" }, NOW));
    expect(out).toContain("---\nNew text\n\n## Activity\n");
    expect(out.slice(out.indexOf("## Activity"))).toBe(ISSUE.slice(ISSUE.indexOf("## Activity")));
  });
});

describe("appending to the feed", () => {
  it("appends a comment verbatim at the end", () => {
    const i = parseIssue(ISSUE, "TIX-12.md");
    const out = appendComment(i, { author: "claude", body: "Done.\nSee PR." }, NOW);
    expect(out.startsWith(ISSUE)).toBe(true);
    expect(out.slice(ISSUE.length)).toBe("\n### @claude · 2026-11-22 09:05\nDone.\nSee PR.\n");
    const back = parseIssue(out, "TIX-12.md");
    expect(back.feed.at(-1)).toEqual({
      type: "comment", id: "L1",
      author: "claude",
      time: "2026-11-22 09:05",
      body: "Done.\nSee PR.",
    });
  });

  it("appends an event directly after another event", () => {
    const text = "---\ntitle: T\n---\nBody\n\n## Activity\n\n- 2026-11-21 10:04 · @kyle created the issue\n";
    const out = appendEvent(parseIssue(text, "TIX-1.md"), { author: "kyle", text: "set priority: none → high" }, NOW);
    expect(out).toBe(text + "- 2026-11-22 09:05 · @kyle set priority: none → high\n");
  });

  it("creates the Activity section on first append", () => {
    const text = "---\ntitle: T\n---\nBody";
    const out = appendEvent(parseIssue(text, "TIX-1.md"), { author: "kyle", text: "created the issue" }, NOW);
    expect(out).toBe("---\ntitle: T\n---\nBody\n\n## Activity\n\n- 2026-11-22 09:05 · @kyle created the issue\n");
    const c = appendComment(parseIssue(out, "TIX-1.md"), { author: "a", body: "hi" }, NOW);
    expect(parseIssue(c, "TIX-1.md").feed.map((e) => e.type)).toEqual(["event", "comment"]);
  });

  it("creates the section for an empty body", () => {
    const out = appendComment(parseIssue("---\ntitle: T\n---\n", "TIX-1.md"), { author: "a", body: "x" }, NOW);
    expect(out).toBe("---\ntitle: T\n---\n## Activity\n\n### @a · 2026-11-22 09:05\nx\n");
  });

  it("includes pending field edits in the appended text", () => {
    const i = applyPatch(parseIssue(ISSUE, "TIX-12.md"), { status: "Done" }, NOW);
    expect(appendEvent(i, { author: "kyle", text: "x" }, NOW)).toContain("status: Done\n");
  });
});

const PROJECT = `---
kind: kt-project
name: kyle-tickets
status: started
lead: kyle
target: 2026-12-31
color: "#5e6ad2"
icon: rocket
custom_key:    keep
milestones:
  - name: Phase 1
    target: 2026-12-01
    description: Foundation
  - name: Phase 2
---
Project description in Markdown.

More.
`;

describe("project file", () => {
  it("round-trips byte-for-byte", () => {
    expect(serializeProject(parseProject(PROJECT, "kyle-tickets.md"))).toBe(PROJECT);
  });

  it("parses fields and milestones", () => {
    const p = parseProject(PROJECT, "kyle-tickets.md");
    expect(p).toMatchObject({
      name: "kyle-tickets",
      status: "started",
      lead: "kyle",
      target: "2026-12-31",
      color: "#5e6ad2",
      icon: "rocket",
      description: "Project description in Markdown.\n\nMore.",
    });
    expect(p.milestones).toEqual([
      { name: "Phase 1", target: "2026-12-01", description: "Foundation" },
      { name: "Phase 2" },
    ]);
  });

  it("writes edits, keeping unknown keys and kind", () => {
    const p = parseProject(PROJECT, "kyle-tickets.md");
    p.status = "paused";
    p.milestones = [...p.milestones, { name: "Phase 3", target: "2027-01-01" }];
    const out = serializeProject(p);
    expect(out).toContain("custom_key: keep\n");
    expect(out).toContain("kind: kt-project\n");
    const back = parseProject(out, "kyle-tickets.md");
    expect(back.status).toBe("paused");
    expect(back.milestones).toHaveLength(3);
    expect(back.description).toBe(p.description);
  });
});

describe("ids", () => {
  it("formats and parses", () => {
    expect(formatId("TIX", 12)).toBe("TIX-12");
    expect(parseId("TIX-12")).toEqual({ prefix: "TIX", n: 12 });
    expect(parseId("nope")).toBeNull();
    expect(parseId("TIX-")).toBeNull();
  });

  it("starts at counter with no files", () => {
    expect(nextId(1, [], "TIX")).toEqual({ id: "TIX-1", counter: 2 });
  });

  it("uses the counter across gaps and never reuses deleted numbers", () => {
    expect(nextId(8, ["TIX-1", "TIX-2", "TIX-5"], "TIX")).toEqual({ id: "TIX-8", counter: 9 });
  });

  it("jumps past files newer than the counter", () => {
    expect(nextId(3, ["TIX-1", "TIX-2", "TIX-10"], "TIX")).toEqual({ id: "TIX-11", counter: 12 });
  });

  it("ignores other prefixes and junk", () => {
    expect(nextId(1, ["ABC-50", "TIX-2", "readme"], "TIX")).toEqual({ id: "TIX-3", counter: 4 });
  });
});

describe("links and defaults", () => {
  it("toLink / fromLink", () => {
    expect(toLink("Name")).toBe("[[Name]]");
    expect(fromLink("[[Name]]")).toBe("Name");
    expect(fromLink("[[Name|alias]]")).toBe("Name");
    expect(fromLink("Plain")).toBe("Plain");
  });

  it("default settings", () => {
    const s = defaultSettings();
    expect(s.prefix).toBe("TIX");
    expect(s.folder).toBe("Tickets");
    expect(s.defaultStatus).toBe("Backlog");
    expect(s.statuses.map((x) => x.name)).toEqual([
      "Triage", "Backlog", "Todo", "In Progress", "In Review", "Done", "Canceled", "Duplicate",
    ]);
    expect(s.statuses.find((x) => x.name === "In Review")?.category).toBe("started");
  });
});
