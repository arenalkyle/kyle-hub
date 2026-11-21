import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { adrTitle, applyDocBudget, glossaryEntries, linkedDocPaths, parsePackInclude, type DocCandidate, type SelectedDoc } from "../domain/packDocs";

export interface SelectDocsInput {
  /** Repo root; docs are read read-only from here. */
  root: string;
  ticket: { title: string; description: string };
  project?: { description: string };
  budgetChars: number;
  /** Use ripgrep for term matching when on PATH (default true). */
  useRipgrep?: boolean;
}

/** True when `term` occurs in `text` (case-insensitive). ripgrep reads the text on stdin; Node is the fallback. */
export function termInText(text: string, term: string, useRipgrep = true): boolean {
  if (term.trim() === "") return false;
  if (useRipgrep) {
    const r = spawnSync("rg", ["--fixed-strings", "--ignore-case", "--quiet", "-e", term, "-"], { input: text, stdio: ["pipe", "ignore", "ignore"] });
    if (r.status === 0) return true;
    if (r.status === 1) return false;
  }
  return text.toLowerCase().includes(term.toLowerCase());
}

const isRepoFile = (root: string, rel: string): boolean => {
  if (path.isAbsolute(rel) || rel.split("/").includes("..")) return false;
  try {
    return fs.statSync(path.join(root, rel)).isFile();
  } catch {
    return false;
  }
};

/**
 * Rule-based doc selection (ADR-0007), priority order:
 * 1. docs linked from the ticket or its project, 2. `.kh/pack-include.txt`,
 * 3. ADR titles and glossary terms that appear in the ticket text. Then the budget is applied.
 */
export function selectBrainDocs(input: SelectDocsInput): SelectedDoc[] {
  const { root, ticket, project } = input;
  const readRepo = (rel: string): string => fs.readFileSync(path.join(root, rel), "utf8");
  const cands: DocCandidate[] = [];
  const seen = new Set<string>();
  const add = (c: DocCandidate): void => {
    if (seen.has(c.path)) return;
    seen.add(c.path);
    cands.push(c);
  };

  const linked: [string, string][] = [
    [ticket.description, "linked from ticket"],
    [project?.description ?? "", "linked from project"],
  ];
  for (const [text, reason] of linked) {
    for (const rel of linkedDocPaths(text)) {
      if (isRepoFile(root, rel)) add({ path: rel, reason, text: readRepo(rel), priority: 1 });
    }
  }

  const includeFile = path.join(".kh", "pack-include.txt");
  if (isRepoFile(root, includeFile)) {
    for (const rel of parsePackInclude(readRepo(includeFile))) {
      if (isRepoFile(root, rel)) add({ path: rel, reason: `listed in ${includeFile.replace(/\\/g, "/")}`, text: readRepo(rel), priority: 2 });
    }
  }

  const ticketText = `${ticket.title}\n${ticket.description}`;
  const adrDir = path.join(root, "docs", "adr");
  if (fs.existsSync(adrDir)) {
    for (const f of fs.readdirSync(adrDir).filter((n) => n.endsWith(".md")).sort()) {
      const rel = `docs/adr/${f}`;
      const text = readRepo(rel);
      const title = adrTitle(text);
      if (title && termInText(ticketText, title, input.useRipgrep)) {
        add({ path: rel, reason: `ADR title "${title}" appears in ticket text`, text, priority: 3 });
      }
    }
  }

  if (isRepoFile(root, "GLOSSARY.md")) {
    for (const { term, body } of glossaryEntries(readRepo("GLOSSARY.md"))) {
      if (termInText(ticketText, term, input.useRipgrep)) {
        cands.push({ path: "GLOSSARY.md", reason: `glossary term "${term}" appears in ticket text`, text: body, priority: 3 });
      }
    }
  }

  return applyDocBudget(cands, input.budgetChars);
}
