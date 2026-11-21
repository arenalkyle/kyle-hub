import { describe, expect, it } from "vitest";
import { appendComment, parseIssue, serializeIssue } from "./issueFile";
import { addReplyText, editCommentIssueText } from "./ops";
import type { Comment } from "./types";

const NOW = new Date(2026, 10, 22, 9, 5, 7);
const LATER = new Date(2026, 10, 23, 10, 0, 0);
const LEGACY =
  "---\nid: TIX-1\ntitle: T\nextra: keep\n---\nDesc\n\n## Activity\n\n- 2026-11-21 10:04 · @kyle created the issue\n\n### @claude · 2026-11-21 11:00\nHello\n\nsecond para\n\n### @kyle · 2026-11-21 12:00\nBye\n\n- 2026-11-21 12:30 · @kyle set priority: none → high\n";

const comments = (text: string): Comment[] =>
  parseIssue(text, "TIX-1.md").feed.filter((f): f is Comment => f.type === "comment");

describe("legacy comments", () => {
  it("get implicit ids and round-trip byte-for-byte", () => {
    const i = parseIssue(LEGACY, "TIX-1.md");
    expect(comments(LEGACY).map((c) => c.id)).toEqual(["L0", "L1"]);
    expect(serializeIssue(i)).toBe(LEGACY);
  });
});

describe("addReplyText", () => {
  it("materialises the legacy parent id and appends a reply", () => {
    const out = addReplyText(LEGACY, "TIX-1.md", "L0", "@bob", "Re: hello", NOW);
    const [a, b, r] = comments(out);
    expect(a!.id).not.toMatch(/^L\d+$/);
    expect(a!.body).toBe("Hello\n\nsecond para");
    expect(b!.id).toBe("L1");
    expect(r).toMatchObject({ author: "bob", body: "Re: hello", replyTo: a!.id });
    expect(r!.id).not.toBe(a!.id);
    expect(out).toContain("extra: keep");
    // untouched comment and event lines stay byte-identical
    expect(out).toContain("### @kyle · 2026-11-21 12:00\nBye\n\n- 2026-11-21 12:30 · @kyle set priority: none → high\n");
  });

  it("targets the root when replying to a reply, and rejects unknown ids", () => {
    const one = addReplyText(LEGACY, "TIX-1.md", "L1", "bob", "r1", NOW);
    const [, root, reply] = comments(one);
    const two = addReplyText(one, "TIX-1.md", reply!.id, "kyle", "r2", LATER);
    expect(comments(two).at(-1)).toMatchObject({ replyTo: root!.id, body: "r2" });
    expect(() => addReplyText(LEGACY, "TIX-1.md", "nope", "bob", "x", NOW)).toThrow(/No comment/);
  });

  it("keeps an explicit parent id as is", () => {
    const base = appendComment(parseIssue("---\ntitle: T\n---\nD\n", "TIX-2.md"), { author: "a", body: "top", id: "cabc123" }, NOW);
    const out = addReplyText(base, "TIX-2.md", "cabc123", "b", "yo", LATER);
    expect(out.slice(out.indexOf("## Activity")).startsWith(base.slice(base.indexOf("## Activity")))).toBe(true);
    expect(out).toContain(" <!-- kt id:");
    expect(comments(out)[1]).toMatchObject({ replyTo: "cabc123", body: "yo" });
  });
});

describe("editCommentIssueText", () => {
  it("replaces only that body, marks edited, keeps neighbours byte-identical", () => {
    const out = editCommentIssueText(LEGACY, "TIX-1.md", "L0", "Hi\n### not a heading", LATER);
    const [a, b] = comments(out);
    expect(a).toMatchObject({ id: "L0", body: "Hi\n### not a heading", edited: true });
    expect(b).toMatchObject({ body: "Bye" });
    expect(b!.edited).toBeUndefined();
    expect(out).toContain("### @kyle · 2026-11-21 12:00\nBye\n\n- 2026-11-21 12:30 · @kyle set priority: none → high\n");
    expect(out).toContain("extra: keep");
    expect(out).toContain("<!-- kt edited -->");
  });

  it("preserves id and reply link, is stable across repeated edits, and throws on unknown ids", () => {
    const replied = addReplyText(LEGACY, "TIX-1.md", "L0", "bob", "r", NOW);
    const [parent, , reply] = comments(replied);
    const e1 = editCommentIssueText(replied, "TIX-1.md", reply!.id, "r2", LATER);
    const e2 = editCommentIssueText(e1, "TIX-1.md", reply!.id, "r3", LATER);
    const r = comments(e2).at(-1)!;
    expect(r).toMatchObject({ id: reply!.id, replyTo: parent!.id, body: "r3", edited: true });
    expect(e2.match(/<!-- kt id:\S+ reply:\S+ edited -->/g)).toHaveLength(1);
    expect(() => editCommentIssueText(LEGACY, "TIX-1.md", "zzz", "x", LATER)).toThrow(/No comment/);
  });

  it("works with CRLF files", () => {
    const crlf = LEGACY.replace(/\n/g, "\r\n");
    const out = editCommentIssueText(crlf, "TIX-1.md", "L1", "New\nbody", LATER);
    expect(out.slice(out.indexOf("## Activity")).replace(/\r\n/g, "")).not.toContain("\n");
    expect(comments(out)[1]).toMatchObject({ body: "New\nbody", edited: true });
  });
});
