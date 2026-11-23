export const DOC_TYPES = ["adr", "glossary", "plan", "status", "runbook", "lesson", "overview", "ticket", "reminder", "proposal"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const AUDIENCES = ["human", "agent"] as const;

/** Days after `reviewed` before `review-overdue`. adr, glossary and ticket never go overdue. */
export const REVIEW_DAYS: Partial<Record<DocType, number>> = {
  status: 14,
  plan: 30,
  runbook: 90,
  overview: 90,
  lesson: 180,
  reminder: 7,
  proposal: 30,
};

/** Repo docs that carry no frontmatter get their type from the path (warning, not error). */
export function inferDocType(relPath: string): DocType | undefined {
  const p = relPath.replace(/\\/g, "/");
  if (p === "STATUS.md") return "status";
  if (p === "GLOSSARY.md") return "glossary";
  if (p === "docs/PLAN.md") return "plan";
  if (/^docs\/adr\/[^/]+\.md$/.test(p)) return "adr";
  if (/^docs\/runbooks\/[^/]+\.md$/.test(p)) return "runbook";
  return undefined;
}

/** Docs a repo lints and checks: inferred-type files that exist plus runbooks. */
export const REPO_DOC_GLOBS = ["STATUS.md", "GLOSSARY.md", "docs/PLAN.md", "docs/adr/*.md", "docs/runbooks/*.md"] as const;

/** Repo locations for `New doc` (ADR-0007: lessons and overviews live only in the vault). */
export const REPO_DOC_TYPES: readonly DocType[] = ["adr", "glossary", "plan", "status", "runbook"];
