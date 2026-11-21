import {
  assemble,
  fmToJs,
  parseFrontmatter,
  splitFrontmatter,
  str,
  syncFrontmatter,
} from "./frontmatter";
import type { Milestone, Project, ProjectStatus } from "./types";

const STATUSES: readonly ProjectStatus[] = [
  "backlog",
  "planned",
  "started",
  "paused",
  "completed",
  "canceled",
];

type Fields = Record<string, unknown>;

function milestonesFrom(v: unknown): Milestone[] {
  if (!Array.isArray(v)) return [];
  const out: Milestone[] = [];
  for (const m of v) {
    if (!m || typeof m !== "object") continue;
    const r = m as Fields;
    const name = str(r.name);
    if (!name) continue;
    const ms: Milestone = { name };
    const target = str(r.target);
    const description = str(r.description);
    if (target) ms.target = target;
    if (description) ms.description = description;
    out.push(ms);
  }
  return out;
}

function fieldsFromFm(fm: Fields, fileName: string): Fields {
  const s = str(fm.status)?.toLowerCase();
  return {
    name: str(fm.name) ?? fileName.replace(/\.md$/i, ""),
    status: (STATUSES as readonly string[]).includes(s ?? "") ? s : "backlog",
    repo: str(fm.repo),
    lead: str(fm.lead),
    target: str(fm.target),
    color: str(fm.color),
    icon: str(fm.icon),
    milestones: milestonesFrom(fm.milestones),
  };
}

const KEYS = Object.keys(fieldsFromFm({}, ""));

function trimBlankEdges(s: string): string {
  return s.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/(?:\r?\n[ \t]*)+$/, "");
}

export function parseProject(text: string, fileName: string): Project {
  const { frontmatterText, body, eol } = splitFrontmatter(text);
  const doc = parseFrontmatter(frontmatterText);
  const f = fieldsFromFm(fmToJs(doc), fileName);
  return {
    ...(f as Omit<Project, "fileName" | "description" | "raw">),
    fileName,
    description: trimBlankEdges(body),
    raw: { frontmatterText, doc, eol, bodyRaw: body },
  };
}

/** Writes edited known fields back; unknown keys and untouched content stay as read. */
export function serializeProject(project: Project): string {
  const { raw } = project;
  const baseline = fieldsFromFm(fmToJs(raw.doc), project.fileName);
  const desired: Fields = {};
  for (const k of KEYS) desired[k] = (project as unknown as Fields)[k];
  const fm = syncFrontmatter(raw.doc, raw.frontmatterText, desired, baseline, { status: "backlog" });
  let body = raw.bodyRaw;
  if (project.description !== trimBlankEdges(raw.bodyRaw)) {
    body = project.description === "" ? "" : project.description + raw.eol;
  }
  // `kind` must always be present.
  const withKind = /^kind:/m.test(fm) ? fm : `kind: kt-project${raw.eol}${fm}`.replace(/(\r?\n)$/, "");
  return assemble(withKind, raw.eol, body);
}
