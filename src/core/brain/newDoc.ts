import { REPO_DOC_TYPES, type DocType } from "./doctypes";

export interface TemplateVars {
  title: string;
  /** `YYYY-MM-DD` */
  date: string;
  /** ADR number, `NNNN` */
  number?: string;
}

export function slugify(title: string): string {
  const s = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s.length > 0 ? s : "untitled";
}

/** Next ADR number from existing `NNNN-slug.md` file names (0001 when none). */
export function nextAdrNumber(fileNames: readonly string[]): string {
  const max = fileNames.reduce((m, f) => {
    const n = Number(/^(\d{4})-/.exec(f)?.[1]);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return String(max + 1).padStart(4, "0");
}

/** Replaces `{{title}}`, `{{date}}` and `{{number}}`. Unknown placeholders are left as they are. */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template
    .replace(/\{\{title\}\}/g, vars.title)
    .replace(/\{\{date\}\}/g, vars.date)
    .replace(/\{\{number\}\}/g, vars.number ?? "");
}

/** Repo-relative path for a new doc, or undefined when the type does not live in repos (ADR-0007). */
export function repoDocPath(type: DocType, title: string, adrFileNames: readonly string[]): string | undefined {
  if (!REPO_DOC_TYPES.includes(type)) return undefined;
  switch (type) {
    case "adr":
      return `docs/adr/${nextAdrNumber(adrFileNames)}-${slugify(title)}.md`;
    case "glossary":
      return "GLOSSARY.md";
    case "plan":
      return "docs/PLAN.md";
    case "status":
      return "STATUS.md";
    case "runbook":
      return `docs/runbooks/${slugify(title)}.md`;
  }
}

/** Vault path for a new doc, under the `Brain/` folder. */
export function vaultDocPath(type: DocType, title: string): string {
  return `Brain/${type}/${slugify(title)}.md`;
}
