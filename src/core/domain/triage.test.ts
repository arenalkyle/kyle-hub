import { describe, expect, it } from "vitest";
import { buildIssueText } from "./create";
import { baseSlices, BASE_FILES } from "./bases";
import { appendComment, parseIssue } from "./issueFile";
import { eventIssueText, removeCommentIssueText } from "./ops";
import { ageLabel, planTriage, seenCount, triageIssues, undoPatch } from "./triage";
import { doneConfirmMessage, guardStatusChange, overrideEventText } from "./transition";
import { groupIssues, orderIssues } from "./query";
import { applyFilters } from "./filters";
import type { Issue, StatusDef } from "./types";

const STATUSES: StatusDef[] = [
  { name: "Triage", category: "triage", color: "", order: 0 },
  { name: "Backlog", category: "backlog", color: "", order: 1 },
  { name: "Todo", category: "unstarted", color: "", order: 2 },
  { name: "Done", category: "completed", color: "", order: 3 },
  { name: "Canceled", category: "canceled", color: "", order: 4 },
];
const at = (min: number): Date => new Date(2026, 10, 21, 12, min, 0);
const text = (id: string, status = "Triage", min = 0, extra = ""): string => {
  const t = buildIssueText(id, { title: id, tags: [] }, status, at(min));
  return extra ? t.replace(/^---\n/, `---\n${extra}\n`) : t;
};
const make = (id: string, status = "Triage", min = 0, extra = ""): Issue => parseIssue(text(id, status, min, extra), `${id}.md`);
const withDesc = (i: Issue, description: string): Issue => ({ ...i, description });
const AC = "## Acceptance criteria\n- [x] a\n- [ ] b\n- [ ] c";

describe("guardStatusChange", () => {
  it("needs confirmation only when entering a completed status with unchecked criteria", () => {
    const i = withDesc(make("T-1", "Todo"), AC);
    expect(guardStatusChange(i, "Done", STATUSES)).toEqual({ ok: false, needsConfirm: true, unchecked: 2, total: 3 });
    expect(doneConfirmMessage({ unchecked: 2, total: 3 })).toBe("2 of 3 criteria unchecked. Mark done anyway?");
    expect(guardStatusChange(i, "Backlog", STATUSES)).toEqual({ ok: true });
    expect(guardStatusChange(i, "Canceled", STATUSES)).toEqual({ ok: true });
  });
  it("passes with no criteria, all checked, an unknown status, or when already completed", () => {
    expect(guardStatusChange(make("T-1", "Todo"), "Done", STATUSES)).toEqual({ ok: true });
    expect(guardStatusChange(withDesc(make("T-1", "Todo"), "## Acceptance criteria\n- [x] a"), "Done", STATUSES)).toEqual({ ok: true });
    expect(guardStatusChange(withDesc(make("T-1", "Todo"), AC), "Nope", STATUSES)).toEqual({ ok: true });
    expect(guardStatusChange(withDesc(make("T-1", "Done"), AC), "Done", STATUSES)).toEqual({ ok: true });
  });
  it("words the override event", () => {
    expect(overrideEventText(2)).toBe("marked done with 2 unchecked criteria (override)");
    expect(overrideEventText(1)).toBe("marked done with 1 unchecked criterion (override)");
  });
});

describe("triage list and plans", () => {
  it("lists only triage tickets, newest first", () => {
    const list = triageIssues([make("T-1", "Triage", 0), make("T-2", "Backlog", 5), make("T-3", "Triage", 10), make("T-4", "Triage", 5)], STATUSES);
    expect(list.map((i) => i.id)).toEqual(["T-3", "T-4", "T-1"]);
  });
  it("sums dedupe comments and labels age", () => {
    let t = text("T-1");
    for (const body of ["seen again (+1) from agent:a", "hello", "seen again (+1) from agent:b"]) t = appendComment(parseIssue(t, "T-1.md"), { author: "x", body }, at(1));
    expect(seenCount(parseIssue(t, "T-1.md"))).toBe(2);
    expect(ageLabel("2026-11-21 12:00", at(5))).toBe("5m");
    expect(ageLabel("2026-11-21 12:00", new Date(2026, 10, 21, 15, 0))).toBe("3h");
    expect(ageLabel("2026-11-21 12:00", new Date(2026, 10, 23, 12, 0))).toBe("2d");
    expect(ageLabel(undefined, at(0))).toBe("");
  });
  it("plans accept, accept + agent-ready and decline", () => {
    const i = make("T-1");
    expect(planTriage(i, "accept", STATUSES, "Backlog")).toEqual({ patch: { status: "Backlog" }, event: "accepted" });
    expect(planTriage(i, "ready", STATUSES, "Backlog")?.patch).toEqual({ status: "Backlog", tags: ["agent-ready"] });
    expect(planTriage(i, "decline", STATUSES, "Backlog", " dupe ")).toEqual({ patch: { status: "Canceled" }, comment: "Declined: dupe" });
    expect(planTriage(i, "accept", STATUSES, "Missing")?.patch.status).toBe("Backlog");
    expect(planTriage(i, "accept", [], "Backlog")).toBeNull();
  });
  it("undo patch restores status and labels", () => {
    expect(undoPatch({ id: "T-1", before: { status: "Triage", tags: ["x"] } })).toEqual({ status: "Triage", tags: ["x"] });
  });
});

describe("comment removal and events", () => {
  it("removes only the named comment", () => {
    let t = text("T-1");
    t = appendComment(parseIssue(t, "T-1.md"), { author: "a", body: "keep" }, at(1));
    t = appendComment(parseIssue(t, "T-1.md"), { author: "a", body: "Declined: nope" }, at(2));
    const last = [...parseIssue(t, "T-1.md").feed].reverse().find((f) => f.type === "comment");
    if (last?.type !== "comment") throw new Error("no comment");
    const out = parseIssue(removeCommentIssueText(t, "T-1.md", last.id, at(3)), "T-1.md");
    expect(out.feed.flatMap((f) => (f.type === "comment" ? [f.body] : []))).toEqual(["keep"]);
  });
  it("appends an event without field changes", () => {
    const out = parseIssue(eventIssueText(text("T-1"), "T-1.md", "me", "accepted", at(2)), "T-1.md");
    expect(out.feed.at(-1)).toMatchObject({ type: "event", text: "accepted" });
    expect(out.status).toBe("Triage");
  });
});

describe("type grouping, ordering and filter", () => {
  const a = make("T-1", "Triage", 0, "type: bug");
  const b = make("T-2", "Triage", 1, "type: proposal");
  const c = make("T-3", "Triage", 2);
  it("groups by type with task as the default", () => {
    const g = groupIssues([a, b, c], "type", { statuses: STATUSES });
    expect(g.map((x) => [x.label, x.issues.map((i) => i.id)])).toEqual([["Task", ["T-3"]], ["Bug", ["T-1"]], ["Proposal", ["T-2"]]]);
  });
  it("orders by type and filters by type", () => {
    expect(orderIssues([b, a, c], "type").map((i) => i.id)).toEqual(["T-3", "T-1", "T-2"]);
    expect(applyFilters([a, b, c], [{ field: "type", op: "in", values: ["task", "bug"] }], new Date()).map((i) => i.id)).toEqual(["T-1", "T-3"]);
  });
});

describe("base slices", () => {
  it("generates the four files from the status settings", () => {
    const s = baseSlices("Tickets", STATUSES);
    expect(Object.keys(s)).toEqual([...BASE_FILES]);
    expect(s["Triage.base"]).toContain('status == "Triage"');
    expect(s["Queue.base"]).toContain('tags.contains("agent-ready")');
    expect(s["Queue.base"]).toContain('status == "Todo"');
    expect(s["Proposals.base"]).toContain('type == "proposal"');
    expect(s["Proposals.base"]).not.toContain('"Done"');
    expect(s["Blocked.base"]).toContain("blockedBy.length > 0");
    expect(s["Triage.base"]).toContain('file.inFolder("Tickets/Issues")');
  });
});
