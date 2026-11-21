import { isValidDate, proseLines } from "./lint";
import { REVIEW_DAYS, type DocType } from "./doctypes";

export type CheckName = "review-overdue" | "status-behind" | "dead-path" | "dead-symbol" | "adr-orphan" | "glossary-unused";

export interface Finding {
  doc: string;
  check: CheckName;
  detail: string;
}

export interface DocInput {
  path: string;
  type?: DocType;
  text: string;
  reviewed?: string;
}

/** Everything the staleness checks may see. Built from disk by `scanRepo`; tests pass fakes. */
export interface RepoSnapshot {
  docs: DocInput[];
  now: Date;
  /** `YYYY-MM-DD` of the repo's last commit; absent outside git. */
  lastCommit?: string;
  exists(relPath: string): boolean;
  /** True when `term` occurs in a repo file other than `excludePath`. */
  mentions(term: string, opts: { ignoreCase: boolean; excludePath: string }): boolean;
  /** Symbols to skip for `dead-symbol`, per repo. */
  ignoreSymbols: readonly string[];
}

const DAY_MS = 86_400_000;
const LAST_UPDATED_RE = /last updated:?\s*\**\s*(\d{4}-\d{2}-\d{2})/i;
const STATUS_BEHIND_DAYS = 7;

const toMs = (v: string | Date): number => (v instanceof Date ? v.getTime() : Date.parse(`${v}T00:00:00Z`));

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string | Date, to: string | Date): number {
  return Math.floor((toMs(to) - toMs(from)) / DAY_MS);
}

/** Backticked spans in prose (fenced code excluded). */
export function backtickTokens(text: string): string[] {
  const out = new Set<string>();
  for (const m of proseLines(text).join("\n").matchAll(/`([^`\n]+)`/g)) out.add(m[1]!.trim());
  return [...out];
}

/** Repo-relative paths: contain a slash, no spaces, wildcards, URLs, absolute or `..` segments. */
export function pathTokens(tokens: readonly string[]): string[] {
  return tokens
    .filter((t) => t.includes("/") && !/[\s*<>{}|]|:\/\/|^~|^\/|^[A-Za-z]:|(^|\/)\.\.(\/|$)/.test(t))
    .map((t) => t.replace(/\/+$/, ""))
    .filter((t) => t.length > 0);
}

/** Conservative code-symbol heuristic: identifier(s) with a hump or underscore, length >= 4. */
export function symbolTokens(tokens: readonly string[]): string[] {
  return tokens.filter((t) => t.length >= 4 && !t.includes("/") && /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(t) && (t.includes("_") || /[a-z][A-Z]/.test(t)));
}

/** `**Term**:` entries of a glossary doc. */
export function glossaryTerms(text: string): string[] {
  return proseLines(text)
    .map((l) => /^\*\*([^*\n]+)\*\*:/.exec(l)?.[1]?.trim())
    .filter((t): t is string => t !== undefined && t.length > 0);
}

/** Runs all six staleness checks. Pure: every fs/git/search fact comes from the snapshot. */
export function runChecks(snap: RepoSnapshot): Finding[] {
  const out: Finding[] = [];
  const push = (doc: string, check: CheckName, detail: string) => out.push({ doc, check, detail });
  const glossaryAll = new Set(snap.docs.filter((d) => d.type === "glossary").flatMap((d) => glossaryTerms(d.text)).map((t) => t.toLowerCase()));
  const ignore = new Set(snap.ignoreSymbols);

  for (const d of snap.docs) {
    const threshold = d.type ? REVIEW_DAYS[d.type] : undefined;
    if (threshold !== undefined && d.reviewed !== undefined && isValidDate(d.reviewed)) {
      const age = daysBetween(d.reviewed, snap.now);
      if (age > threshold) push(d.path, "review-overdue", `reviewed ${d.reviewed} (${age}d ago, limit ${threshold}d)`);
    }

    if (d.type === "status" && snap.lastCommit !== undefined) {
      const m = LAST_UPDATED_RE.exec(d.text);
      if (m && isValidDate(m[1]!)) {
        const behind = daysBetween(m[1]!, snap.lastCommit);
        if (behind > STATUS_BEHIND_DAYS) push(d.path, "status-behind", `last updated ${m[1]}, last commit ${snap.lastCommit} (${behind}d behind)`);
      }
    }

    const tokens = backtickTokens(d.text);
    const paths = [...new Set(pathTokens(tokens))];
    for (const p of paths) if (!snap.exists(p)) push(d.path, "dead-path", `${p} does not exist`);

    if (d.type === "adr" && paths.length > 0 && paths.every((p) => !snap.exists(p))) {
      push(d.path, "adr-orphan", `none of the ${paths.length} referenced paths exist`);
    }

    for (const s of new Set(symbolTokens(tokens))) {
      if (glossaryAll.has(s.toLowerCase()) || ignore.has(s)) continue;
      if (!snap.mentions(s, { ignoreCase: false, excludePath: d.path })) push(d.path, "dead-symbol", `\`${s}\` not found in repo`);
    }

    if (d.type === "glossary") {
      for (const term of glossaryTerms(d.text)) {
        if (!snap.mentions(term, { ignoreCase: true, excludePath: d.path })) push(d.path, "glossary-unused", `term "${term}" not used outside this file`);
      }
    }
  }
  return out;
}
