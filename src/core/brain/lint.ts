import { fmToJs, parseFrontmatter, splitFrontmatter } from "../domain/frontmatter";
import { AUDIENCES, DOC_TYPES, inferDocType, type DocType } from "./doctypes";

export interface LintIssue {
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface DocMeta {
  type?: DocType;
  reviewed?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LAST_UPDATED_RE = /last updated:?\s*\**\s*(\d{4}-\d{2}-\d{2})/i;
const STATUS_LABELS = ["Done", "In progress", "Next"] as const;

export function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Date-only string from a frontmatter value (YAML may hand back a Date). */
function dateValue(v: unknown): string | undefined {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString().slice(0, 10);
  return typeof v === "string" ? v : undefined;
}

/** Body lines with fenced code blocks removed. */
export function proseLines(body: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) out.push(line);
  }
  return out;
}

/** Frontmatter `doctype` (or the path-inferred type) and `reviewed`, for checks. Never throws. */
export function docMeta(relPath: string, text: string): DocMeta {
  let fm: Record<string, unknown> = {};
  try {
    fm = fmToJs(parseFrontmatter(splitFrontmatter(text).frontmatterText));
  } catch {
    fm = {};
  }
  const declared = typeof fm.doctype === "string" && (DOC_TYPES as readonly string[]).includes(fm.doctype) ? (fm.doctype as DocType) : undefined;
  return { type: declared ?? inferDocType(relPath), reviewed: dateValue(fm.reviewed) };
}

/** Validates one doc: frontmatter (`doctype`, `audience`, `reviewed`) and the required sections of its type. */
export function lintDoc(relPath: string, text: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const add = (severity: LintIssue["severity"], message: string) => issues.push({ severity, path: relPath, message });
  const inferred = inferDocType(relPath);

  let body = text;
  let fm: Record<string, unknown> | undefined;
  try {
    const split = splitFrontmatter(text);
    body = split.body;
    fm = fmToJs(parseFrontmatter(split.frontmatterText));
  } catch (e) {
    if (/no frontmatter/.test((e as Error).message)) fm = undefined;
    else {
      add("error", (e as Error).message);
      return issues;
    }
  }

  let type: DocType | undefined;
  if (fm?.doctype !== undefined) {
    if (typeof fm.doctype === "string" && (DOC_TYPES as readonly string[]).includes(fm.doctype)) type = fm.doctype as DocType;
    else {
      add("error", `unknown doctype "${String(fm.doctype)}" (expected ${DOC_TYPES.join(", ")})`);
      return issues;
    }
  } else if (inferred) {
    type = inferred;
    add("warning", `${fm ? "no doctype" : "no frontmatter"}; inferred "${inferred}" from path`);
  } else {
    add("error", fm ? "missing doctype" : "missing frontmatter (doctype, audience, reviewed)");
    return issues;
  }

  // Inferred docs get warnings for missing frontmatter fields; declared docs get errors.
  // Inferred docs without frontmatter get only the "no frontmatter" warning above.
  const report = fm?.doctype !== undefined ? (s: LintIssue["severity"], m: string) => add(s, m) : (_s: LintIssue["severity"], m: string) => add("warning", m);
  if (fm !== undefined) {
    if (typeof fm.audience !== "string" || !(AUDIENCES as readonly string[]).includes(fm.audience)) {
      report("error", `audience must be ${AUDIENCES.join(" or ")}`);
    }
    const reviewed = dateValue(fm.reviewed);
    if (reviewed === undefined || !isValidDate(reviewed)) report("error", "reviewed must be a YYYY-MM-DD date");
  }

  const lines = proseLines(body);
  const headings = lines.filter((l) => /^#{1,6}\s/.test(l)).map((l) => l.replace(/^#+\s*/, "").trim());
  const hasTitle = lines.some((l) => /^#\s+\S/.test(l));
  const requireHeading = (h: string) => {
    if (!headings.some((x) => x.toLowerCase() === h.replace(/^#+\s*/, "").toLowerCase())) add("error", `missing section "${h}"`);
  };
  const requireTitle = () => {
    if (!hasTitle) add("error", "missing title (# heading)");
  };

  switch (type) {
    case "adr": {
      requireTitle();
      const h1 = lines.findIndex((l) => /^#\s+\S/.test(l));
      const para = lines.slice(h1 + 1).some((l) => l.trim() !== "" && !/^#/.test(l));
      if (!para) add("error", "missing context paragraph after title");
      break;
    }
    case "glossary":
      if (!lines.some((l) => /^\*\*[^*\n]+\*\*:/.test(l))) add("error", 'no "**Term**:" entries');
      break;
    case "plan":
      requireTitle();
      break;
    case "status": {
      if (!LAST_UPDATED_RE.test(body)) add("error", "missing last-updated date (e.g. _Last updated: YYYY-MM-DD_)");
      for (const label of STATUS_LABELS) {
        const re = new RegExp(`^(#{1,6}\\s*|[-*]\\s*\\*\\*|\\*\\*)${label.replace(/ /g, "\\s+")}\\b`, "im");
        if (!re.test(body)) add("error", `missing status section "${label}"`);
      }
      break;
    }
    case "runbook":
      requireTitle();
      requireHeading("## Steps");
      break;
    case "lesson":
      requireTitle();
      requireHeading("## Lesson");
      break;
    case "overview":
      requireTitle();
      requireHeading("## Summary");
      break;
  }
  return issues;
}
