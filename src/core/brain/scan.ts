import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { docMeta, lintDoc, type LintIssue } from "./lint";
import { REPO_DOC_GLOBS, inferDocType } from "./doctypes";
import { runChecks, type DocInput, type Finding, type RepoSnapshot } from "./checks";

export interface ScanOptions {
  /** Use ripgrep when on PATH (default true). The Node scan is the fallback. */
  useRipgrep?: boolean;
  ignoreSymbols?: readonly string[];
  now?: Date;
}

const SCAN_EXT = new Set([".md", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".css", ".yml", ".yaml", ".txt", ".html"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage"]);

const toRel = (p: string): string => p.replace(/\\/g, "/");

/** Lintable repo docs that exist: the REPO_DOC_GLOBS set (inferred types and runbooks). */
export function repoDocPaths(root: string): string[] {
  const out: string[] = [];
  for (const g of REPO_DOC_GLOBS) {
    if (!g.includes("*")) {
      if (fs.existsSync(path.join(root, g))) out.push(g);
      continue;
    }
    const dir = path.dirname(g);
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).sort()) if (f.endsWith(".md") && inferDocType(`${dir}/${f}`) !== undefined) out.push(`${dir}/${f}`);
  }
  return out;
}

/** Last commit date (`YYYY-MM-DD`) or undefined outside git. */
export function lastCommitDate(root: string): string | undefined {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cs"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : undefined;
  } catch {
    return undefined;
  }
}

export function hasRipgrep(): boolean {
  return spawnSync("rg", ["--version"], { stdio: "ignore" }).status === 0;
}

/** ripgrep: exit 0 = found, 1 = not found; anything else is an error and throws. */
export function mentionsRipgrep(root: string, term: string, opts: { ignoreCase: boolean; excludePath: string }): boolean {
  const args = ["--fixed-strings", "--quiet", "--glob", `!${opts.excludePath}`, "--glob", "!node_modules", "--glob", "!.git"];
  if (opts.ignoreCase) args.push("--ignore-case");
  args.push("-e", term, ".");
  const r = spawnSync("rg", args, { cwd: root, stdio: "ignore" });
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  throw new Error(`ripgrep failed (exit ${String(r.status)}) searching for "${term}"`);
}

/** Node fallback: scans text files under root, skipping SKIP_DIRS. */
export function mentionsNode(root: string, term: string, opts: { ignoreCase: boolean; excludePath: string }): boolean {
  const needle = opts.ignoreCase ? term.toLowerCase() : term;
  const exclude = toRel(opts.excludePath);
  const walk = (dir: string): boolean => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name) && walk(abs)) return true;
        continue;
      }
      if (!ent.isFile() || !SCAN_EXT.has(path.extname(ent.name).toLowerCase())) continue;
      if (toRel(path.relative(root, abs)) === exclude) continue;
      const text = fs.readFileSync(abs, "utf8");
      if ((opts.ignoreCase ? text.toLowerCase() : text).includes(needle)) return true;
    }
    return false;
  };
  return walk(root);
}

/** Reads the repo's lintable docs and builds the snapshot the checks run on. */
export function scanRepo(root: string, opts: ScanOptions = {}): { snapshot: RepoSnapshot; docPaths: string[] } {
  const useRg = opts.useRipgrep ?? hasRipgrep();
  const docPaths = repoDocPaths(root);
  const docs: DocInput[] = docPaths.map((p) => {
    const text = fs.readFileSync(path.join(root, p), "utf8");
    const meta = docMeta(p, text);
    return { path: p, text, ...(meta.type !== undefined ? { type: meta.type } : {}), ...(meta.reviewed !== undefined ? { reviewed: meta.reviewed } : {}) };
  });
  const lastCommit = lastCommitDate(root);
  const snapshot: RepoSnapshot = {
    docs,
    now: opts.now ?? new Date(),
    ...(lastCommit !== undefined ? { lastCommit } : {}),
    exists: (rel) => fs.existsSync(path.join(root, rel)),
    mentions: (term, o) => (useRg ? mentionsRipgrep(root, term, o) : mentionsNode(root, term, o)),
    ignoreSymbols: opts.ignoreSymbols ?? [],
  };
  return { snapshot, docPaths };
}

/** Lint + staleness for one repo. */
export function checkRepo(root: string, opts: ScanOptions = {}): { issues: LintIssue[]; findings: Finding[]; docs: string[] } {
  const { snapshot, docPaths } = scanRepo(root, opts);
  const issues = snapshot.docs.flatMap((d) => lintDoc(d.path, d.text));
  return { issues, findings: runChecks(snapshot), docs: docPaths };
}

/** Lints every .md under a vault `Brain/` folder (paths are reported as `Brain/...`, so no path inference). */
export function lintVaultBrain(brainDir: string): LintIssue[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.name.endsWith(".md")) files.push(toRel(path.relative(brainDir, abs)));
    }
  };
  walk(brainDir);
  return files.sort().flatMap((f) => lintDoc(`Brain/${f}`, fs.readFileSync(path.join(brainDir, f), "utf8")));
}
