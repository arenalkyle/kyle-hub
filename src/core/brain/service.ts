import path from "node:path";
import fs from "node:fs";
import type { NewIssueInput } from "../domain/create";
import type { TicketActor } from "../services";
import { DOC_BUDGET_TOKENS, CHARS_PER_TOKEN, type SelectedDoc } from "../domain/packDocs";
import type { LintIssue } from "./lint";
import { checkRepo, lintVaultBrain, type ScanOptions } from "./scan";
import type { Finding } from "./checks";
import { DEFAULT_HEALTH_WEIGHTS, healthScore, sumCounts, type HealthCounts, type HealthWeights } from "./health";
import { selectBrainDocs } from "./selectDocs";
import { parseGradingConfig } from "../domain/grading";
import { brainInventory, type BrainInventory } from "./inventory";

export interface RepoEntry {
  path: string;
}

export interface BrainReport {
  repo: string;
  docs: string[];
  issues: LintIssue[];
  findings: Finding[];
}

export interface RepoHealth extends HealthCounts {
  score: number;
}

/** `vault` aggregates every repo plus the vault `Brain/` folder. */
export interface BrainHealth {
  vault: RepoHealth;
  repos: Record<string, RepoHealth>;
}

export interface HealthChangedPayload {
  scope: "repo" | "vault";
  key: string;
  score: number;
  previous?: number;
}

export interface BrainService {
  /** Lint + staleness for one repo-map key. Throws when the key is unknown. Recomputes health. */
  check(repoKey: string): BrainReport;
  /** Lintable repo docs (repo-relative paths) for one repo-map key. */
  docs(repoKey: string): string[];
  /** Checks every repo and the vault Brain/ folder, then recomputes health. */
  refreshHealth(): BrainHealth;
  /** Last computed health snapshot (computed on first call when nothing was checked yet). */
  health(): BrainHealth;
  /** Counts of docs, scripts, skills and agents the brain draws on. */
  inventory(): BrainInventory;
  /** Rule-based doc selection for a context pack; `budgetTokens` defaults to 8k. */
  selectDocs(ticket: { repo: string; title: string; description: string }, project: { description: string } | undefined, budgetTokens?: number): { docs: SelectedDoc[] };
}

export interface BrainServiceDeps {
  repos(): Record<string, RepoEntry>;
  ignoreSymbols(repoKey: string): readonly string[];
  scan?: Pick<ScanOptions, "useRipgrep" | "now">;
  /** `<vault>/Brain`; undefined when no vault is known (vault health then counts nothing). */
  vaultBrainDir?(): string | undefined;
  weights?(): HealthWeights;
  /** Receives `brain:health-changed` (wired to the event bus by the module). */
  emit?(event: HealthChangedPayload): void;
}

const VAULT_KEY = "vault";
const countsOf = (issues: readonly LintIssue[], findings: readonly Finding[]): HealthCounts => ({
  lintErrors: issues.filter((i) => i.severity === "error").length,
  lintWarnings: issues.filter((i) => i.severity === "warning").length,
  stalenessIssues: findings.length,
});

export function createBrainService(deps: BrainServiceDeps): BrainService {
  const rootOf = (key: string): string => {
    const r = deps.repos()[key];
    if (!r) throw new Error(`unknown repo "${key}" (not in the repo map)`);
    return path.resolve(r.path);
  };
  const repoCounts = new Map<string, HealthCounts>();
  let vaultLint: HealthCounts = { lintErrors: 0, lintWarnings: 0, stalenessIssues: 0 };
  const lastScores = new Map<string, number>();
  let snapshot: BrainHealth | undefined;

  /** `exclude` globs of the vault `grading.json` (the vault is the parent of `Brain/`). */
  const vaultExclude = (brainDir: string): string[] => {
    try {
      return parseGradingConfig(fs.readFileSync(path.join(path.dirname(brainDir), ".kyle-hub", "grading.json"), "utf8")).config.exclude;
    } catch {
      return [];
    }
  };

  const vaultBrainCounts = (): HealthCounts => {
    const dir = deps.vaultBrainDir?.();
    if (!dir || !fs.existsSync(dir)) return { lintErrors: 0, lintWarnings: 0, stalenessIssues: 0 };
    const issues = lintVaultBrain(dir, vaultExclude(dir));
    return countsOf(issues, []);
  };

  /** Recomputes scores from the cached counts and emits only the scopes whose score changed. */
  const publish = (): BrainHealth => {
    const weights = deps.weights?.() ?? DEFAULT_HEALTH_WEIGHTS;
    const repos: Record<string, RepoHealth> = {};
    for (const [key, c] of repoCounts) repos[key] = { ...c, score: healthScore(c, weights) };
    const vc = sumCounts([...repoCounts.values(), vaultLint]);
    const vault: RepoHealth = { ...vc, score: healthScore(vc, weights) };
    snapshot = { vault, repos };
    const scopes: [string, "repo" | "vault", number][] = [[VAULT_KEY, "vault", vault.score], ...Object.entries(repos).map(([k, r]): [string, "repo" | "vault", number] => [k, "repo", r.score])];
    for (const [key, scope, score] of scopes) {
      const id = `${scope}:${key}`;
      const previous = lastScores.get(id);
      if (previous === score) continue;
      lastScores.set(id, score);
      deps.emit?.({ scope, key, score, ...(previous !== undefined ? { previous } : {}) });
    }
    return snapshot;
  };

  const record = (repoKey: string, res: ReturnType<typeof checkRepo>): BrainReport => {
    repoCounts.set(repoKey, countsOf(res.issues, res.findings));
    publish();
    return { repo: repoKey, docs: res.docs, issues: res.issues, findings: res.findings };
  };

  return {
    check(repoKey) {
      const res = checkRepo(rootOf(repoKey), { ...deps.scan, ignoreSymbols: deps.ignoreSymbols(repoKey) });
      return record(repoKey, res);
    },
    docs(repoKey) {
      return checkRepo(rootOf(repoKey), { ...deps.scan, ignoreSymbols: deps.ignoreSymbols(repoKey) }).docs;
    },
    refreshHealth() {
      for (const key of Object.keys(deps.repos())) {
        try {
          record(key, checkRepo(rootOf(key), { ...deps.scan, ignoreSymbols: deps.ignoreSymbols(key) }));
        } catch {
          /* a missing repo path is reported by `kh doctor`; it does not block the others */
        }
      }
      vaultLint = vaultBrainCounts();
      return publish();
    },
    health() {
      return snapshot ?? this.refreshHealth();
    },
    inventory() {
      const keys = Object.keys(deps.repos());
      let repoDocs = 0;
      const repoRoots: string[] = [];
      for (const k of keys) {
        try {
          repoDocs += this.docs(k).length;
          repoRoots.push(rootOf(k));
        } catch {
          /* missing repo path: skipped, reported by `kh doctor` */
        }
      }
      const vaultBrainDir = deps.vaultBrainDir?.();
      return brainInventory({ repoRoots, repoDocs, ...(vaultBrainDir ? { vaultBrainDir, vaultExclude: vaultExclude(vaultBrainDir) } : {}) });
    },
    selectDocs(ticket, project, budgetTokens = DOC_BUDGET_TOKENS) {
      const docs = selectBrainDocs({
        root: rootOf(ticket.repo),
        ticket: { title: ticket.title, description: ticket.description },
        project,
        budgetChars: budgetTokens * CHARS_PER_TOKEN,
        useRipgrep: deps.scan?.useRipgrep,
      });
      return { docs };
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
