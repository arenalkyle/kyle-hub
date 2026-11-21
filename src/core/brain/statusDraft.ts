/** Pure STATUS.md skeleton for `kh status draft` (Done / In progress / Next / last-updated). */
export interface StatusDraftInput {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Commit subjects since the last STATUS update, newest first. */
  commits: string[];
  tickets: { id: string; title: string; status: string }[];
  lastTest?: { at: string; passed: number; failed: number; command?: string };
}

const MAX_COMMITS = 15;
const MAX_NEXT = 10;
const DONE = new Set(["done"]);
const ACTIVE = new Set(["in progress", "in review"]);
const DROPPED = new Set(["canceled", "cancelled", "duplicate"]);

export function draftStatus(input: StatusDraftInput): string {
  const state = (t: { status: string }): "done" | "active" | "dropped" | "next" => {
    const s = t.status.toLowerCase();
    if (DONE.has(s)) return "done";
    if (ACTIVE.has(s)) return "active";
    if (DROPPED.has(s)) return "dropped";
    return "next";
  };
  const by = (k: "done" | "active" | "next") => input.tickets.filter((t) => state(t) === k);
  const bullets = (lines: string[]): string[] => (lines.length ? lines : ["- (none)"]);

  const done = bullets([
    ...by("done").map((t) => `- ${t.id}: ${t.title}`),
    ...input.commits.slice(0, MAX_COMMITS).map((c) => `- ${c}`),
  ]);
  const inProgress = bullets(by("active").map((t) => `- ${t.id}: ${t.title} (${t.status})`));
  const next = bullets(by("next").slice(0, MAX_NEXT).map((t) => `- ${t.id}: ${t.title}`));
  const test = input.lastTest
    ? `_Last test: ${input.lastTest.passed} passed, ${input.lastTest.failed} failed (${input.lastTest.at})${input.lastTest.command ? `, \`${input.lastTest.command}\`` : ""}_`
    : "_Last test: none recorded_";

  return [
    "# STATUS",
    "",
    `_Last updated: ${input.date}_`,
    "",
    "## Done",
    "",
    ...done,
    "",
    "## In progress",
    "",
    ...inProgress,
    "",
    "## Next",
    "",
    ...next,
    "",
    test,
    "",
  ].join("\n");
}
