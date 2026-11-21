import { lintDoc, type LintIssue } from "../../core/brain/lint";
import { nextAdrNumber, renderTemplate, repoDocPath, vaultDocPath } from "../../core/brain/newDoc";
import type { DocType } from "../../core/brain/doctypes";
import { TEMPLATES } from "./templates";

/** Local `YYYY-MM-DD`. */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export type NewDocLocation = { kind: "repo"; root: string; adrFileNames: readonly string[] } | { kind: "vault" };

export interface NewDocPlan {
  /** Repo-relative (repo) or `Brain/...` (vault) path. */
  path: string;
  content: string;
  issues: LintIssue[];
}

/** Pure: the file `New doc` would create and what lint says about it. Throws when the type is not allowed in repos. */
export function planNewDoc(type: DocType, title: string, date: string, location: NewDocLocation): NewDocPlan {
  const number = location.kind === "repo" && type === "adr" ? nextAdrNumber(location.adrFileNames) : undefined;
  const path = location.kind === "repo" ? repoDocPath(type, title, location.adrFileNames) : vaultDocPath(type, title);
  if (path === undefined) throw new Error(`${type} docs live in the vault Brain/ folder, not in a repo (ADR-0007)`);
  const content = renderTemplate(TEMPLATES[type], { title, date, ...(number !== undefined ? { number } : {}) });
  return { path, content, issues: lintDoc(path, content) };
}
