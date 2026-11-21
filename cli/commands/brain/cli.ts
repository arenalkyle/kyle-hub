import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { lintDoc, type LintIssue } from "../../../src/core/brain/lint";
import { checkRepo, lintVaultBrain, repoDocPaths } from "../../../src/core/brain/scan";
import { fileFindings, type RepoEntry } from "../../../src/core/brain/service";
import type { Finding } from "../../../src/core/brain/checks";
import { EXIT, KtError, run as runTickets, type Io } from "../tickets/cli";

const LINT_USAGE = "kh lint docs [--repo <key>|--vault] [--json]";
const CHECK_USAGE = "kh brain check [--repo <key>] [--json] [--tickets] [--dir <tickets folder>]";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export interface HubDataView {
  repos: Record<string, RepoEntry>;
  ignoreSymbols: Record<string, string[]>;
  autoFindings: boolean;
  vault?: string;
}

/** Read-only view of the first configured vault's plugin data.json (repo map, brain settings). */
export function readHubData(env: Record<string, string | undefined>): HubDataView {
  const vault = (env.KYLE_HUB_VAULTS ?? env.KYLE_TICKETS_VAULTS ?? "").split(";").map((s) => s.trim()).find((s) => s.length > 0);
  const empty: HubDataView = { repos: {}, ignoreSymbols: {}, autoFindings: false, ...(vault ? { vault } : {}) };
  if (!vault) return empty;
  try {
    const data: unknown = JSON.parse(fs.readFileSync(path.join(vault, ".obsidian", "plugins", "kyle-hub", "data.json"), "utf8"));
    if (!isObj(data) || !isObj(data.modules)) return empty;
    const core = isObj(data.modules.core) ? data.modules.core : {};
    const brain = isObj(data.modules.brain) ? data.modules.brain : {};
    const ignoreSymbols: Record<string, string[]> = {};
    if (isObj(brain.ignoreSymbols)) for (const [k, v] of Object.entries(brain.ignoreSymbols)) if (Array.isArray(v)) ignoreSymbols[k] = v.map(String);
    return {
      ...empty,
      repos: isObj(core.repos) ? (core.repos as Record<string, RepoEntry>) : {},
      ignoreSymbols,
      autoFindings: brain.autoFindings === true,
    };
  } catch {
    return empty;
  }
}

function parse(argv: string[], options: Record<string, { type: "string" | "boolean" }>, usage: string): Record<string, string | boolean | undefined> {
  try {
    return parseArgs({ args: argv, options, strict: true, allowPositionals: false }).values;
  } catch (e) {
    throw new KtError(EXIT.usage, `${(e as Error).message}. Usage: ${usage}`);
  }
}

function repoRootOf(data: HubDataView, key: string): string {
  const r = data.repos[key];
  if (!r) throw new KtError(EXIT.usage, `unknown repo "${key}" (not in the repo map)`);
  return path.resolve(r.path);
}

/** `kh lint docs`: exit 1 when any error; warnings print and pass. */
export function runLintDocs(argv: string[], io: Io, data: HubDataView = readHubData(io.env)): number {
  const v = parse(argv, { repo: { type: "string" }, vault: { type: "boolean" }, json: { type: "boolean" } }, LINT_USAGE);
  if (v.repo !== undefined && v.vault === true) throw new KtError(EXIT.usage, `Use --repo or --vault, not both. Usage: ${LINT_USAGE}`);
  const issues: (LintIssue & { repo: string })[] = [];
  if (v.vault === true) {
    if (!data.vault) throw new KtError(EXIT.usage, "No vault configured (KYLE_HUB_VAULTS / KYLE_TICKETS_VAULTS).");
    issues.push(...lintVaultBrain(path.join(data.vault, "Brain")).map((i) => ({ ...i, repo: "vault" })));
  } else {
    const keys = v.repo !== undefined ? [String(v.repo)] : Object.keys(data.repos);
    for (const key of keys) {
      const root = repoRootOf(data, key);
      for (const p of repoDocPaths(root)) {
        issues.push(...lintDoc(p, fs.readFileSync(path.join(root, p), "utf8")).map((i) => ({ ...i, repo: key })));
      }
    }
  }
  const errors = issues.filter((i) => i.severity === "error").length;
  if (v.json === true) io.out(JSON.stringify(issues, null, 2));
  else {
    for (const i of issues) io.out(`[${i.severity}] ${i.repo}: ${i.path}: ${i.message}`);
    io.out(`lint: ${errors} error(s), ${issues.length - errors} warning(s)`);
  }
  return errors > 0 ? 1 : EXIT.ok;
}

/** Files findings through `kh tickets new --agent` (source agent:brain, fingerprint from the finding group). */
async function fileViaCli(repo: string, findings: readonly Finding[], io: Io, dir?: string): Promise<{ filed: string[]; skipped: string[] }> {
  const env = { ...io.env, KH_RUN: "brain" };
  const sink = {
    create: (input: { title: string; repo?: string; description?: string; fingerprint?: string }) => {
      const args = ["new", input.title, "--agent", "--type", "finding", "--repo", input.repo ?? repo, "--description", input.description ?? "", "--fingerprint", input.fingerprint ?? ""];
      if (dir) args.push("--dir", dir);
      let out = "";
      const code = runTickets(args, { ...io, env, out: (s: string) => (out += `${s}\n`) });
      if (code !== EXIT.ok) return Promise.reject(new Error(out.trim() || `exit ${code}`));
      return Promise.resolve({ id: out.trim() });
    },
  };
  const res = await fileFindings(repo, findings, sink);
  return { filed: res.filed, skipped: res.skipped };
}

/** `kh brain check`: lint + staleness per repo; `--tickets` files the findings. */
export async function runBrainCheck(argv: string[], io: Io, data: HubDataView = readHubData(io.env)): Promise<number> {
  const v = parse(argv, { repo: { type: "string" }, json: { type: "boolean" }, tickets: { type: "boolean" }, dir: { type: "string" } }, CHECK_USAGE);
  const keys = v.repo !== undefined ? [String(v.repo)] : Object.keys(data.repos);
  const report: { repo: string; lint: number; findings: Finding[]; filed?: string[]; skipped?: string[] }[] = [];
  for (const key of keys) {
    const res = checkRepo(repoRootOf(data, key), { ignoreSymbols: data.ignoreSymbols[key] ?? [] });
    const entry: (typeof report)[number] = { repo: key, lint: res.issues.length, findings: res.findings };
    if (v.tickets === true) {
      const filed = await fileViaCli(key, res.findings, io, v.dir !== undefined ? String(v.dir) : undefined);
      entry.filed = filed.filed;
      entry.skipped = filed.skipped;
    }
    report.push(entry);
  }
  if (v.json === true) {
    io.out(JSON.stringify(report, null, 2));
    return EXIT.ok;
  }
  for (const r of report) {
    io.out(`[${r.repo}] lint issues ${r.lint}, findings ${r.findings.length}${r.filed !== undefined ? `, filed ${r.filed.length}` : ""}`);
    for (const f of r.findings.slice(0, 50)) io.out(`  ${f.check.padEnd(16)} ${f.doc}: ${f.detail}`);
    for (const s of r.skipped ?? []) io.out(`  skipped: ${s}`);
  }
  return EXIT.ok;
}

/** Dispatch for `kh lint ...` and `kh brain ...`. */
export async function runBrain(cmd: "lint" | "brain", argv: string[], io: Io): Promise<number> {
  const [sub, ...rest] = argv;
  if (cmd === "lint" && sub === "docs") return runLintDocs(rest, io);
  if (cmd === "brain" && sub === "check") return runBrainCheck(rest, io);
  throw new KtError(EXIT.usage, `Usage: ${LINT_USAGE} | ${CHECK_USAGE}`);
}
