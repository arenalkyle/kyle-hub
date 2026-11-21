import path from "node:path";
import type { NewIssueInput } from "../domain/create";
import type { TicketActor } from "../services";
import type { LintIssue } from "./lint";
import { checkRepo, type ScanOptions } from "./scan";
import type { Finding } from "./checks";

export interface RepoEntry {
  path: string;
}

export interface BrainReport {
  repo: string;
  docs: string[];
  issues: LintIssue[];
  findings: Finding[];
}

export interface BrainService {
  /** Lint + staleness for one repo-map key. Throws when the key is unknown. */
  check(repoKey: string): BrainReport;
  /** Lintable repo docs (repo-relative paths) for one repo-map key. */
  docs(repoKey: string): string[];
}

export interface BrainServiceDeps {
  repos(): Record<string, RepoEntry>;
  ignoreSymbols(repoKey: string): readonly string[];
  scan?: Pick<ScanOptions, "useRipgrep" | "now">;
}

export function createBrainService(deps: BrainServiceDeps): BrainService {
  const rootOf = (key: string): string => {
    const r = deps.repos()[key];
    if (!r) throw new Error(`unknown repo "${key}" (not in the repo map)`);
    return path.resolve(r.path);
  };
  return {
    check(repoKey) {
      const res = checkRepo(rootOf(repoKey), { ...deps.scan, ignoreSymbols: deps.ignoreSymbols(repoKey) });
      return { repo: repoKey, docs: res.docs, issues: res.issues, findings: res.findings };
    },
    docs(repoKey) {
      return checkRepo(rootOf(repoKey), { ...deps.scan, ignoreSymbols: deps.ignoreSymbols(repoKey) }).docs;
    },
  };
}

/** Findings grouped per check+doc (fingerprint `brain:<check>:<doc>`), one ticket each. */
export interface FindingGroup {
  fingerprint: string;
  title: string;
  description: string;
}

export function groupFindings(repo: string, findings: readonly Finding[]): FindingGroup[] {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = `brain:${f.check}:${f.doc}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  return [...groups].map(([fingerprint, list]) => ({
    fingerprint,
    title: `Brain: ${list[0]!.check} in ${list[0]!.doc} (${repo})`,
    description: list.map((f) => `- ${f.detail}`).join("\n"),
  }));
}

export interface FileFindingsResult {
  filed: string[];
  skipped: string[];
}

/** Files findings as agent tickets (triage status, deduped by fingerprint, capped by the ticket gates). */
/** Anything that files a ticket (TicketService or the CLI's `kh tickets new --agent` adapter). */
export interface FindingSink {
  create(input: NewIssueInput, actor?: TicketActor): Promise<{ id: string }>;
}

export async function fileFindings(repo: string, findings: readonly Finding[], tickets: FindingSink, actor: TicketActor = { agent: true, author: "brain" }): Promise<FileFindingsResult> {
  const res: FileFindingsResult = { filed: [], skipped: [] };
  for (const g of groupFindings(repo, findings)) {
    try {
      const issue = await tickets.create({ title: g.title, type: "finding", repo, description: `## Findings\n\n${g.description}`, fingerprint: g.fingerprint }, actor);
      res.filed.push(issue.id);
    } catch (e) {
      res.skipped.push(`${g.fingerprint}: ${(e as Error).message}`);
    }
  }
  return res;
}
