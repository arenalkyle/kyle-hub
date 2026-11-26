import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createExcludeMatcher, hasCodeMarker } from "../domain/codeRoots";
import { DEFAULT_BRAIN_FOLDER } from "../domain/brainPaths";

export interface BrainInventory {
  /** Markdown docs the brain reads: repo docs plus the vault brain folder. */
  docs: number;
  scripts: number;
  skills: number;
  agents: number;
}

const SCRIPT_EXT = new Set([".sh", ".ps1", ".cmd", ".bat", ".js", ".mjs", ".cjs", ".ts", ".py"]);
const SKIP = new Set(["node_modules", ".git", "dist", "build"]);

function walk(dir: string, depth: number, visit: (file: string) => void, skipDir?: (dir: string, names: string[]) => boolean): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  if (skipDir?.(dir, entries.map((e) => e.name))) return;
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth > 0) walk(p, depth - 1, visit, skipDir);
    } else visit(p);
  }
}

const countFiles = (dir: string, depth: number, keep: (f: string) => boolean, skipDir?: (dir: string, names: string[]) => boolean): number => {
  let n = 0;
  walk(
    dir,
    depth,
    (f) => {
      if (keep(f)) n++;
    },
    skipDir,
  );
  return n;
};

const countSkills = (dir: string): number => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, "SKILL.md"))).length;
  } catch {
    return 0;
  }
};

/** Counts what the brain draws on. `repoDocs` is the already-linted doc total; `claudeDirs` are `.claude` folders to scan for skills and agents. */
export function brainInventory(opts: { repoRoots: string[]; repoDocs: number; vaultBrainDir?: string; vaultBrainRel?: string; extraClaudeDirs?: string[]; vaultExclude?: string[] }): BrainInventory {
  const rel = opts.vaultBrainRel ?? DEFAULT_BRAIN_FOLDER;
  const claudeDirs = [...opts.repoRoots.map((r) => path.join(r, ".claude")), path.join(os.homedir(), ".claude"), ...(opts.extraClaudeDirs ?? [])];
  const vaultExcluded = createExcludeMatcher(opts.vaultExclude ?? []);
  const vaultRel = (p: string): string => `${rel}/${path.relative(opts.vaultBrainDir ?? "", p).replaceAll("\\", "/")}`;
  const skipVaultCode = (dir: string, names: string[]): boolean =>
    dir !== opts.vaultBrainDir && (hasCodeMarker(names) || vaultExcluded(vaultRel(dir)));
  // Files are matched too, as the lint does: a `dir/**` glob matches `dir/a.md` but not the folder `dir` itself.
  const isVaultDoc = (f: string): boolean => f.endsWith(".md") && !vaultExcluded(vaultRel(f));
  const uniq = [...new Set(claudeDirs.map((d) => path.resolve(d)))];
  return {
    docs: opts.repoDocs + (opts.vaultBrainDir ? countFiles(opts.vaultBrainDir, 6, isVaultDoc, skipVaultCode) : 0),
    scripts: opts.repoRoots.reduce((n, r) => n + countFiles(path.join(r, "scripts"), 3, (f) => SCRIPT_EXT.has(path.extname(f))), 0),
    skills: uniq.reduce((n, d) => n + countSkills(path.join(d, "skills")), 0),
    agents: uniq.reduce((n, d) => n + countFiles(path.join(d, "agents"), 1, (f) => f.endsWith(".md")), 0),
  };
}
