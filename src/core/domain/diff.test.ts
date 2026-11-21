import { describe, expect, it } from "vitest";
import { buildIssueText } from "./create";
import { diffToEvents } from "./diff";
import { applyPatch, parseIssue } from "./issueFile";

const NOW = new Date(2026, 10, 21, 10, 20, 0);
const base = () =>
  parseIssue(buildIssueText("TIX-1", { title: "T", tags: ["a", "b"], project: "P" }, "Backlog", NOW), "TIX-1.md");
const texts = (a: ReturnType<typeof base>, b: ReturnType<typeof base>) =>
  diffToEvents(a, b, "kyle", NOW).map((e) => e.text);

describe("diffToEvents", () => {
  it("no-op diff produces no events", () => {
    const i = base();
    expect(diffToEvents(i, i, "kyle", NOW)).toEqual([]);
    expect(diffToEvents(i, applyPatch(i, {}, new Date(2027, 0, 1)), "kyle", NOW)).toEqual([]);
  });

  it("ignores description, sortOrder, pullRequests and updated", () => {
    const i = base();
    const j = applyPatch(i, { description: "x", sortOrder: 5, pullRequests: ["u"] }, new Date(2027, 0, 1));
    expect(texts(i, j)).toEqual([]);
  });

  it("covers every tracked field", () => {
    const i = base();
    const j = applyPatch(
      i,
      {
        title: "U",
        status: "In Progress",
        priority: "high",
        assignee: "claude",
        project: "[[Q]]",
        milestone: "M1",
        parent: "[[TIX-0]]",
        due: "2026-12-01",
        tags: ["b", "c"],
      },
      NOW,
    );
    expect(texts(i, j)).toEqual([
      "set title: T → U",
      "set status: Backlog → In Progress",
      "set priority: No priority → High",
      "set assignee: none → claude",
      "set project: P → Q",
      "set milestone: none → M1",
      "set parent: none → TIX-0",
      "set due: none → 2026-12-01",
      "added label: c",
      "removed label: a",
    ]);
  });

  it("reports cleared fields as none and stamps author and time", () => {
    const i = base();
    const [e] = diffToEvents(i, applyPatch(i, { project: null }, NOW), "@kyle", NOW);
    expect(e).toEqual({ type: "event", author: "kyle", time: "2026-11-21 10:20", text: "set project: P → none" });
  });
});
