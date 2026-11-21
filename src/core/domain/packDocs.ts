/** Pure doc selection for context packs (ADR-0007): budget, parsing of link lists and glossary/ADR entries. */

/** ~8k tokens at 4 chars per token. */
export const DOC_BUDGET_TOKENS = 8_000;
export const CHARS_PER_TOKEN = 4;
const MARK = "\n[truncated]";

/** 1 = linked from ticket/project, 2 = `.kh/pack-include.txt`, 3 = ADR/glossary term match. Lower number wins. */
export type DocPriority = 1 | 2 | 3;

export interface DocCandidate {
  path: string;
  reason: string;
  text: string;
  priority: DocPriority;
}

export interface SelectedDoc {
  path: string;
  reason: string;
  text: string;
}

/**
 * Keeps candidates in priority order (stable within a priority) until the char budget is spent.
 * The doc that overflows is truncated to what is left; everything after it is dropped (lowest priority first).
 */
export function applyDocBudget(candidates: readonly DocCandidate[], budgetChars: number): SelectedDoc[] {
  const ordered = [...candidates].sort((a, b) => a.priority - b.priority);
  const out: SelectedDoc[] = [];
  let used = 0;
  for (const c of ordered) {
    const left = budgetChars - used;
    if (left <= 0) break;
    if (c.text.length <= left) {
      out.push({ path: c.path, reason: c.reason, text: c.text });
      used += c.text.length;
      continue;
    }
    const cut = left > MARK.length ? c.text.slice(0, left - MARK.length).trimEnd() + MARK : "";
    if (cut) out.push({ path: c.path, reason: c.reason, text: cut });
    break;
  }
  return out;
}

/** `.kh/pack-include.txt`: one repo-relative path per line; blank lines and `#` comments skipped. */
export function parsePackInclude(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
}

/** Repo-relative `*.md` paths named in free text (markdown links, backticks or bare). Unsafe paths are dropped. */
export function linkedDocPaths(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![\w/.-])((?:[\w-]+\/)*[\w.-]+\.md)(?![\w/-])/g)) {
    const rel = m[1]!.replace(/\\/g, "/");
    if (rel.startsWith("/") || rel.split("/").includes("..")) continue;
    if (!out.includes(rel)) out.push(rel);
  }
  return out;
}

/** The first `# ` heading of an ADR. */
export function adrTitle(text: string): string | undefined {
  const line = text.split(/\r?\n/).find((l) => /^#\s+\S/.test(l));
  return line?.replace(/^#\s+/, "").trim() || undefined;
}

/** GLOSSARY.md entries: a `**Term**:` line plus the lines below it up to the next bold term or heading. */
export function glossaryEntries(text: string): { term: string; body: string }[] {
  const lines = text.split(/\r?\n/);
  const out: { term: string; body: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = /^\*\*(.+?)\*\*:\s*$/.exec(lines[i]!);
    if (!head) continue;
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length && !/^\*\*.+?\*\*:/.test(lines[j]!) && !/^#{1,6}\s/.test(lines[j]!); j++) body.push(lines[j]!);
    out.push({ term: head[1]!.trim(), body: [lines[i]!, ...body].join("\n").trim() });
    i = j - 1;
  }
  return out;
}
