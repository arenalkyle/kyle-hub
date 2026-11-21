import { parseAcceptance } from "./acceptance";
import type { SelectedDoc } from "./packDocs";

/** ~8k tokens at 4 chars per token. */
export const PACK_BUDGET_CHARS = 32_000;
const PARENT_LINES = 40;
const ACCEPTANCE_HEADING = /^##[ \t]+Acceptance criteria[ \t]*\r?$/i;

export interface PackInput {
  runId: string;
  ticket: { id: string; title: string; description: string };
  repo?: string;
  branch?: string;
  parent?: { id: string; title: string; description: string };
  /** Each blocker with the body of its last comment, when it has one. */
  blockers?: { id: string; title: string; lastComment?: string }[];
  /** Run id of an earlier launch of this ticket. */
  previousRun?: string;
  /** Brain-selected docs (budgeted by the brain module). Undefined = brain off: no docs section. */
  docs?: SelectedDoc[];
  /** Characters; the description is cut first, then the parent summary, blockers. */
  budget?: number;
}

/** Fixed footer of every pack (ticket-only until brain docs land in 7.2). */
export function packFooter(id: string): string {
  return [
    "## Instructions",
    "",
    `- Work only on ticket ${id}; do not start other tickets.`,
    "- Commit your work on the current branch.",
    `- When finished, run \`kt comment ${id} "<summary: what changed, tests run, anything left>"\` and tick the acceptance criteria you satisfied.`,
    "- Do not change the ticket status.",
  ].join("\n");
}

/** Description without its `## Acceptance criteria` section (rendered separately). */
export function stripAcceptance(description: string): string {
  const lines = description.split("\n");
  const start = lines.findIndex((l) => ACCEPTANCE_HEADING.test(l));
  if (start < 0) return description;
  let end = start + 1;
  while (end < lines.length && !/^#{1,2}[ \t]/.test(lines[end]!)) end++;
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n").trim();
}

const MARK = "\n[truncated]";

function renderDocs(docs: SelectedDoc[]): string {
  if (docs.length === 0) return "## Docs included\n\n(none selected)";
  const list = docs.map((d) => `- \`${d.path}\`: ${d.reason}`).join("\n");
  const bodies = docs.map((d) => `### ${d.path}\n\n${d.text.trim()}`).join("\n\n");
  return `## Docs included\n\n${list}\n\n${bodies}`;
}

function fit(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= MARK.length) return "";
  return text.slice(0, max - MARK.length).trimEnd() + MARK;
}

/** Pure: the Markdown context pack for one ticket run. */
export function buildPack(input: PackInput): string {
  const budget = input.budget ?? PACK_BUDGET_CHARS;
  const { ticket } = input;
  const meta = [`Run: ${input.runId}`, input.repo ? `Repo: ${input.repo}` : "", input.branch ? `Branch: ${input.branch}` : ""].filter(Boolean).join(" · ");
  const head = `# ${ticket.id}: ${ticket.title}\n\n${meta}`;
  const criteria = parseAcceptance(ticket.description).items;
  const acceptance = criteria.length
    ? ["## Acceptance criteria", "", ...criteria.map((c) => `- [${c.checked ? "x" : " "}] ${c.text}`)].join("\n")
    : "";
  const footer = packFooter(ticket.id);
  const docs = input.docs === undefined ? "" : renderDocs(input.docs);

  // Truncatable sections, cut in this order: description, parent, blockers, previous run.
  const desc = stripAcceptance(ticket.description).trim();
  const parentBody = input.parent ? input.parent.description.split("\n").slice(0, PARENT_LINES).join("\n").trim() : "";
  const blockers = (input.blockers ?? []).map((b) => `### ${b.id}: ${b.title}\n\n${b.lastComment?.trim() || "(no comments)"}`).join("\n\n");
  const prev = input.previousRun ? `Previous run of this ticket: ${input.previousRun}. The worktree is reused; check \`git log\` and the ticket comments for what was done.` : "";

  const sections = {
    desc: desc ? { title: "## Description", body: desc } : null,
    parent: input.parent ? { title: `## Parent: ${input.parent.id}: ${input.parent.title}`, body: parentBody } : null,
    blockers: blockers ? { title: "## Blockers (last comment)", body: blockers } : null,
    prev: prev ? { title: "## Previous run", body: prev } : null,
  };
  const render = (s: { title: string; body: string } | null): string => (s && s.body ? `${s.title}\n\n${s.body}` : s ? s.title : "");
  const assemble = (): string =>
    [head, render(sections.desc), acceptance, docs, render(sections.parent), render(sections.blockers), render(sections.prev), footer].filter(Boolean).join("\n\n") + "\n";

  for (const key of ["desc", "parent", "blockers", "prev"] as const) {
    const s = sections[key];
    if (!s) continue;
    const over = assemble().length - budget;
    if (over <= 0) break;
    s.body = fit(s.body, Math.max(0, s.body.length - over));
  }
  return assemble();
}
