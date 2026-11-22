import fs from "node:fs";
import path from "node:path";
import { computeGaps, type GapsReport, type NoteFact, type ReadFact, type SearchFact, type WriteFact } from "../domain/gaps";
import { parseGradingConfig } from "../domain/grading";
import { docMeta, proseLines } from "../brain/lint";
import { splitFrontmatter } from "../domain/frontmatter";
import type { LogService, Profile } from "../logs/types";

const normRoot = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

export const GAPS_DIR = path.join(".kyle-hub", "gaps");
export const GRADING_FILE = path.join(".kyle-hub", "grading.json");
const SKIP_DIRS = new Set([".obsidian", ".git", ".kyle-hub", ".trash", "node_modules"]);
const WIKILINK = /!?\[\[([^\]\n]+)\]\]/g;

/** Notes of the vault: every `.md` outside hidden tool folders, with word count, mtime, `reviewed` and wikilinks. */
export function scanVaultNotes(vaultRoot: string): NoteFact[] {
  const out: NoteFact[] = [];
  const walk = (rel: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(vaultRoot, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const child = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(child);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
        const full = path.join(vaultRoot, child);
        try {
          const text = fs.readFileSync(full, "utf8");
          let body = text;
          try {
            body = splitFrontmatter(text).body;
          } catch {
            // no frontmatter: the whole file is the body
          }
          const prose = proseLines(body).join("\n");
          const reviewed = docMeta(child, text).reviewed;
          const reviewedMs = reviewed ? Date.parse(reviewed) : NaN;
          const links = [...prose.matchAll(WIKILINK)].map((m) => m[1]!).filter((l) => !/\.(?!md$)[a-z0-9]{2,5}$/i.test(l.split("|")[0]!.split("#")[0]!));
          out.push({
            path: child,
            words: prose.split(/\s+/).filter((w) => w !== "").length,
            mtimeMs: fs.statSync(full).mtimeMs,
            ...(Number.isFinite(reviewedMs) ? { reviewedMs } : {}),
            links,
          });
        } catch {
          // unreadable note: skipped
        }
      }
    }
  };
  walk("");
  return out;
}

export interface GatherOptions {
  vaultRoot: string;
  logs: LogService;
  now?: Date;
  /** Profile of this vault: only its spool and runs count. Omitted = every profile. */
  profile?: Profile;
  /** Every configured vault, first first. Records without a vault id belong to the first. Omitted = just `vaultRoot`. */
  allVaults?: readonly string[];
}

/** Collects vault-scoped facts (hook spool accesses, transcript search records, run durations) and computes the report. */
export async function gatherGaps(opts: GatherOptions): Promise<GapsReport> {
  const now = opts.now ?? new Date();
  let gradingText: string | undefined;
  try {
    gradingText = fs.readFileSync(path.join(opts.vaultRoot, GRADING_FILE), "utf8");
  } catch {
    gradingText = undefined;
  }
  const { config, warning } = parseGradingConfig(gradingText);
  const since = new Date(now.getTime() - config.windowDays * 86_400_000).toISOString();

  const notes = scanVaultNotes(opts.vaultRoot);
  const reads: ReadFact[] = [];
  const writes: WriteFact[] = [];
  const vaultSessions = new Set<string>();
  const mine = (recVault: string | undefined): boolean => normRoot(recVault ?? opts.allVaults?.[0] ?? opts.vaultRoot) === normRoot(opts.vaultRoot);
  for (const a of await opts.logs.accessSince(since, opts.profile)) {
    if (!mine(a.vault)) continue;
    const session = a.parentSessionId ?? a.sessionId;
    vaultSessions.add(session);
    if (!a.path) continue;
    if (a.kind === "read") reads.push({ path: a.path, sessionId: session });
    else if (a.kind === "write") writes.push({ path: a.path, sessionId: session, t: a.t, ...(a.before ? { before: a.before } : {}), ...(a.after ? { after: a.after } : {}) });
  }

  const searches: SearchFact[] = [];
  let agentMs = 0;
  let readMs = 0;
  for (const run of await opts.logs.runs({ since, ...(opts.profile ? { profile: opts.profile } : {}) })) {
    let hasSearch = false;
    for await (const r of opts.logs.records(run.runId)) {
      if (r.type === "file_read" && typeof r.vault === "string" && mine(r.vault)) {
        hasSearch = true;
        if (typeof r.durationMs === "number") readMs += r.durationMs;
        continue;
      }
      if (r.type !== "search" || typeof r.root !== "string" || !mine(typeof r.vault === "string" ? r.vault : undefined)) continue;
      hasSearch = true;
      searches.push({
        root: r.root,
        ...(typeof r.pattern === "string" ? { pattern: r.pattern } : {}),
        ...(typeof r.hits === "number" ? { hits: r.hits } : {}),
        ...(typeof r.durationMs === "number" ? { durationMs: r.durationMs } : {}),
      });
    }
    if (hasSearch || vaultSessions.has(run.sessionId)) agentMs += run.durationMs;
  }
  return computeGaps({ now, notes, reads, writes, searches, agentMs, readMs, config, ...(warning ? { warning } : {}) });
}

/** Adds `.kyle-hub/gaps/` to the vault `.gitignore` once, keeping existing content; returns whether it changed the file. */
export function ensureGapsIgnored(vaultRoot: string): boolean {
  const file = path.join(vaultRoot, ".gitignore");
  const entry = ".kyle-hub/gaps/";
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    text = "";
  }
  const has = text.split(/\r?\n/).some((l) => ["/.kyle-hub/gaps/", ".kyle-hub/gaps/", ".kyle-hub/gaps", "/.kyle-hub/gaps"].includes(l.trim()));
  if (has) return false;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  fs.writeFileSync(file, `${text}${text === "" || text.endsWith("\n") ? "" : eol}${entry}${eol}`);
  return true;
}

/** Computes the report and writes `<vault>/.kyle-hub/gaps/latest.json` (and the `.gitignore` entry). */
export async function writeGaps(opts: GatherOptions): Promise<{ report: GapsReport; file: string }> {
  const report = await gatherGaps(opts);
  const dir = path.join(opts.vaultRoot, GAPS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "latest.json");
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  ensureGapsIgnored(opts.vaultRoot);
  return { report, file };
}
