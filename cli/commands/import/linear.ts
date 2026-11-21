import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildIssueText } from "../../../src/core/domain/create";
import { nextId } from "../../../src/core/domain/ids";
import { appendComment, applyPatch, parseIssue, serializeIssue } from "../../../src/core/domain/issueFile";
import type { IssuePatch } from "../../../src/core/domain/issueFile";
import { fromLink } from "../../../src/core/domain/links";
import type { Issue, Priority, Settings, StatusCategory } from "../../../src/core/domain/types";
import { EXIT, KtError, atomicCreate, discoverFolder, loadCtx, loadIssues, mdFiles, type Io } from "../tickets/cli";

/** Transport seam: the real one calls Linear; tests inject a recorded fixture. */
export interface LinearTransport {
  request(query: string, variables: Record<string, unknown>): Promise<unknown>;
}

export interface LinearComment {
  body: string;
  createdAt: string;
  user: { name: string } | null;
}

export interface LinearIssue {
  identifier: string;
  title: string;
  description: string | null;
  priority: number;
  createdAt: string;
  updatedAt: string;
  state: { type: string; name: string };
  labels: { nodes: { name: string }[] };
  parent: { identifier: string } | null;
  comments: { nodes: LinearComment[] };
}

interface IssuesPage {
  issues?: { nodes: LinearIssue[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
}

export const ISSUES_QUERY = `query KhImportIssues($filter: IssueFilter, $after: String) {
  issues(filter: $filter, first: 100, after: $after) {
    nodes {
      identifier title description priority createdAt updatedAt
      state { type name }
      labels { nodes { name } }
      parent { identifier }
      comments { nodes { body createdAt user { name } } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const LINEAR_URL = "https://api.linear.app/graphql";
const MAX_PAGES = 1000;

/** Real transport. The key goes only in the Authorization header and is never logged. */
export function linearHttp(apiKey: string): LinearTransport {
  return {
    async request(query, variables) {
      const res = await fetch(LINEAR_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: apiKey },
        body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) throw new Error(`Linear API returned HTTP ${res.status}`);
      const json = (await res.json()) as { data?: unknown; errors?: { message: string }[] };
      if (json.errors?.length) throw new Error(`Linear API error: ${json.errors[0]!.message}`);
      return json.data;
    },
  };
}

/** Pages through every issue matching the team (and optional project) filter. */
export async function fetchIssues(t: LinearTransport, team: string, project?: string): Promise<LinearIssue[]> {
  const filter: Record<string, unknown> = { team: { key: { eq: team } } };
  if (project) filter.project = { name: { eq: project } };
  const out: LinearIssue[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = (await t.request(ISSUES_QUERY, { filter, after })) as IssuesPage | undefined;
    const p = data?.issues;
    if (!p) throw new Error("Linear response has no issues field");
    out.push(...p.nodes);
    if (!p.pageInfo.hasNextPage || !p.pageInfo.endCursor) return out;
    after = p.pageInfo.endCursor;
  }
  throw new Error("Linear pagination did not terminate");
}

const PRIORITY: Record<number, Priority> = { 0: "none", 1: "urgent", 2: "high", 3: "medium", 4: "low" };
const CATEGORIES = new Set<string>(["triage", "backlog", "unstarted", "started", "completed", "canceled"]);

/** Maps a Linear state type to the first vault status of the same category; falls back to the default status. */
export function statusFor(settings: Settings, stateType: string): string {
  if (!CATEGORIES.has(stateType)) return settings.defaultStatus;
  const cat = stateType as StatusCategory;
  const hit = [...settings.statuses].sort((a, b) => a.order - b.order).find((s) => s.category === cat);
  return hit?.name ?? settings.defaultStatus;
}

/** Feed authors must be one token (kh feed rule); display names are kept with spaces as dashes. */
export function feedAuthor(name: string | undefined): string {
  const a = (name ?? "").trim().replace(/^@/, "").replace(/\s+/g, "-");
  return a === "" ? "linear" : a;
}

const uniqueTags = (li: LinearIssue): string[] => [...new Set(li.labels.nodes.map((l) => l.name.trim()).filter(Boolean))];

const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

interface Summary { fetched: number; created: number; skipped: number; updated: number; failed: number; warnings: string[] }

export async function runImport(argv: string[], io: Io, transport?: LinearTransport): Promise<number> {
  let values: { team?: string; project?: string; "dry-run"?: boolean; update?: boolean; dir?: string };
  try {
    values = parseArgs({
      args: argv,
      options: {
        team: { type: "string" }, project: { type: "string" }, dir: { type: "string" },
        "dry-run": { type: "boolean" }, update: { type: "boolean" },
      },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (e) {
    throw new KtError(EXIT.usage, `${(e as Error).message}. Usage: kh import linear --team <key> [--project <name>] [--dry-run] [--update]`);
  }
  if (!values.team) throw new KtError(EXIT.usage, "Missing --team <key>.");

  const apiKey = io.env.LINEAR_API_KEY?.trim() ?? "";
  if (!transport && apiKey === "") {
    throw new KtError(EXIT.config, "LINEAR_API_KEY is not set. Export it in this shell (it is never stored in the repo or vault).");
  }
  const t = transport ?? linearHttp(apiKey);
  const dryRun = values["dry-run"] === true;
  const ctx = loadCtx(discoverFolder(values.dir, io));
  const now = io.now();

  const linear = (await fetchIssues(t, values.team, values.project)).sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.identifier.localeCompare(b.identifier),
  );

  const existing = loadIssues(ctx);
  const byLinear = new Map<string, Issue>();
  for (const i of existing) if (i.linearId) byLinear.set(i.linearId, i);
  const vaultId = new Map<string, string>();
  for (const [lid, i] of byLinear) vaultId.set(lid, i.id);

  // Pass 1: allocate vault IDs for new tickets so parent links resolve in pass 2.
  const ids = [...existing.map((i) => i.id), ...mdFiles(ctx.issuesDir).map((n) => n.replace(/\.md$/i, ""))];
  const fresh = linear.filter((li) => !byLinear.has(li.identifier));
  for (const li of fresh) {
    const { id } = nextId(Math.max(1, ctx.counter), ids, ctx.settings.prefix);
    ids.push(id);
    vaultId.set(li.identifier, id);
  }

  const summary: Summary = { fetched: linear.length, created: 0, skipped: 0, updated: 0, failed: 0, warnings: [] };
  const say = (s: string): void => io.out(s);
  if (!dryRun) fs.mkdirSync(ctx.issuesDir, { recursive: true });

  // Pass 2: create new tickets with comments.
  for (const li of fresh) {
    const id = vaultId.get(li.identifier)!;
    const fileName = `${id}.md`;
    const parentLinear = li.parent?.identifier;
    let parent: string | undefined;
    if (parentLinear) {
      parent = vaultId.get(parentLinear);
      if (!parent) summary.warnings.push(`${li.identifier}: parent ${parentLinear} is not in this import; left unparented`);
    }
    let text = buildIssueText(id, {
      title: li.title.trim(),
      status: statusFor(ctx.settings, li.state.type),
      priority: PRIORITY[li.priority] ?? "none",
      tags: uniqueTags(li),
      parent,
      description: li.description ?? "",
      linearId: li.identifier,
      created: new Date(li.createdAt),
      updated: new Date(li.updatedAt),
    }, ctx.settings.defaultStatus, now);
    const comments = [...li.comments.nodes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const c of comments) {
      text = appendComment(parseIssue(text, fileName), { author: feedAuthor(c.user?.name), body: c.body }, new Date(c.createdAt));
    }
    if (dryRun) {
      summary.created++;
      say(`would create ${id} <- ${li.identifier} ${li.title.trim()}`);
      continue;
    }
    try {
      if (atomicCreate(path.join(ctx.issuesDir, fileName), text)) {
        summary.created++;
        say(`created ${id} <- ${li.identifier} ${li.title.trim()}`);
      } else summary.skipped++;
    } catch (e) {
      summary.failed++;
      summary.warnings.push(`${li.identifier}: write failed (${(e as Error).message})`);
    }
  }

  // Linked tickets from earlier imports: skipped unless --update, which refreshes the mapped fields only.
  for (const li of linear) {
    const issue = byLinear.get(li.identifier);
    if (!issue) continue;
    if (!values.update) {
      summary.skipped++;
      continue;
    }
    const patch: IssuePatch = {};
    const title = li.title.trim();
    if (title !== issue.title) patch.title = title;
    const status = statusFor(ctx.settings, li.state.type);
    if (status !== issue.status) patch.status = status;
    const priority = PRIORITY[li.priority] ?? "none";
    if (priority !== issue.priority) patch.priority = priority;
    const tags = uniqueTags(li);
    if (!sameList(tags, issue.tags)) patch.tags = tags;
    const description = li.description ?? "";
    if (description !== issue.description) patch.description = description;
    const parentId = li.parent ? vaultId.get(li.parent.identifier) ?? null : null;
    if (li.parent && parentId === null) summary.warnings.push(`${li.identifier}: parent ${li.parent.identifier} is not in this import; parent unchanged`);
    else if (parentId !== null && parentId !== fromLink(issue.parent ?? "")) patch.parent = parentId;
    if (Object.keys(patch).length === 0) {
      summary.skipped++;
      continue;
    }
    if (dryRun) {
      summary.updated++;
      say(`would update ${issue.id} <- ${li.identifier}`);
      continue;
    }
    const file = path.join(ctx.issuesDir, issue.fileName);
    try {
      fs.writeFileSync(file, serializeIssue(applyPatch(issue, patch, now)), "utf8");
      summary.updated++;
      say(`updated ${issue.id} <- ${li.identifier}`);
    } catch (e) {
      summary.failed++;
      summary.warnings.push(`${li.identifier}: update failed (${(e as Error).message})`);
    }
  }

  for (const w of summary.warnings) io.err(`kh: ${w}`);
  const mode = dryRun ? " (dry run, nothing written)" : "";
  say(`fetched ${summary.fetched}, created ${summary.created}, skipped ${summary.skipped}, updated ${summary.updated}, failed ${summary.failed}${mode}`);
  return summary.failed > 0 ? EXIT.validation : EXIT.ok;
}
