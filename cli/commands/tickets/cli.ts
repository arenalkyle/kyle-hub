import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildIssueText } from "../../../src/core/domain/create";
import { PRIORITY_ORDER, defaultSettings } from "../../../src/core/domain/defaults";
import { formatId, nextId, parseId } from "../../../src/core/domain/ids";
import { appendComment, appendEvent, parseIssue } from "../../../src/core/domain/issueFile";
import type { IssuePatch } from "../../../src/core/domain/issueFile";
import { MODELS, OUTCOMES, TICKET_TYPES, parseModel, parseOutcome, parseType } from "../../../src/core/domain/fields";
import type { Model, Outcome, TicketType } from "../../../src/core/domain/fields";
import { DEFAULT_FLOOD, expiredTriage } from "../../../src/core/domain/flood";
import type { FloodSettings } from "../../../src/core/domain/flood";
import { planAgentCreate } from "../../../src/core/domain/agentCreate";
import { agentSource, checkAgentLabels, checkAgentStatus, isAgentMode } from "../../../src/core/domain/gates";
import type { GateResult } from "../../../src/core/domain/gates";
import { fromLink } from "../../../src/core/domain/links";
import { milestoneAfterProjectChange } from "../../../src/core/domain/milestones";
import { addRelatedList, relatedIds, removeRelatedLists } from "../../../src/core/domain/related";
import { addReplyText, commentIssueText, issueToJson, linkPrText, patchIssueText } from "../../../src/core/domain/ops";
import { parseProject } from "../../../src/core/domain/projectFile";
import type { Issue, Priority, Project, Settings } from "../../../src/core/domain/types";
import { mergeData } from "../../../src/modules/tickets/src/data";

export interface Io {
  cwd: string;
  env: Record<string, string | undefined>;
  stdin: () => string;
  out: (s: string) => void;
  err: (s: string) => void;
  now: () => Date;
}

export const EXIT = { ok: 0, usage: 1, notFound: 2, validation: 3, config: 2, remote: 4 } as const;

export class KtError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}
const usage = (m: string): KtError => new KtError(EXIT.usage, m);
const notFound = (m: string): KtError => new KtError(EXIT.notFound, m);
const invalid = (m: string): KtError => new KtError(EXIT.validation, m);

export const MARKER = ".kyle-tickets.json";
const PLUGIN_DATA = [".obsidian", "plugins", "kyle-tickets", "data.json"];

// ---- discovery & settings ------------------------------------------------

const isFile = (p: string): boolean => fs.existsSync(p) && fs.statSync(p).isFile();
const isDir = (p: string): boolean => fs.existsSync(p) && fs.statSync(p).isDirectory();

function readJson(p: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return undefined;
  }
}

/** `dir` itself, or its `Tickets/` child (or the plugin's configured folder), when it holds the marker. */
function folderAt(dir: string): string | null {
  if (isFile(path.join(dir, MARKER))) return dir;
  const names = ["Tickets"];
  const data = readJson(path.join(dir, ...PLUGIN_DATA)) as { settings?: { folder?: unknown } } | undefined;
  const f = data?.settings?.folder;
  if (typeof f === "string" && f.trim() !== "") names.unshift(f.trim());
  for (const n of names) {
    const c = path.join(dir, n);
    if (isFile(path.join(c, MARKER))) return c;
  }
  return null;
}

export function discoverFolder(dirOpt: string | undefined, io: Pick<Io, "cwd" | "env">): string {
  const explicit = dirOpt ?? (io.env.KT_DIR || undefined);
  if (explicit !== undefined) {
    const abs = path.resolve(io.cwd, explicit);
    const f = folderAt(abs);
    if (f) return f;
    throw notFound(`No ${MARKER} in "${abs}" (or its Tickets/ child). Pass the tickets folder with --dir or KT_DIR.`);
  }
  let cur = path.resolve(io.cwd);
  for (;;) {
    const f = folderAt(cur);
    if (f) return f;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw notFound(`No tickets folder found from "${io.cwd}" upward (looked for ${MARKER}). Run from inside the vault, or use --dir <path> / KT_DIR.`);
}

export interface Ctx {
  folder: string;
  settings: Settings;
  counter: number;
  issuesDir: string;
  projectsDir: string;
  flood: FloodSettings;
}

const HUB_DATA = [".obsidian", "plugins", "kyle-hub", "data.json"];

/** Flood numbers from the hub's `core` namespace (defaults when absent). */
function floodFrom(vaultRoot: string): FloodSettings {
  const raw = readJson(path.join(vaultRoot, ...HUB_DATA)) as { modules?: { core?: { flood?: Partial<FloodSettings> } } } | undefined;
  return { ...DEFAULT_FLOOD, ...(raw?.modules?.core?.flood ?? {}) };
}

export function loadCtx(folder: string): Ctx {
  const settings = defaultSettings();
  let counter = 0;
  let flood = DEFAULT_FLOOD;
  const marker = readJson(path.join(folder, MARKER)) as { prefix?: unknown } | undefined;
  if (typeof marker?.prefix === "string" && marker.prefix) settings.prefix = marker.prefix;
  // Vault root = nearest ancestor holding the plugin's data.json (read-only here).
  let cur = folder;
  for (;;) {
    const dataPath = path.join(cur, ...PLUGIN_DATA);
    if (isFile(dataPath)) {
      const raw = readJson(dataPath);
      if (raw !== undefined) {
        const d = mergeData(raw);
        Object.assign(settings, d.settings);
        counter = d.idCounter;
      }
      flood = floodFrom(cur);
      break;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return { folder, settings, counter, flood, issuesDir: path.join(folder, "Issues"), projectsDir: path.join(folder, "Projects") };
}

// ---- files ---------------------------------------------------------------

export function mdFiles(dir: string): string[] {
  if (!isDir(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".md") && !n.startsWith("."));
}

export function loadIssues(ctx: Ctx): Issue[] {
  const out: Issue[] = [];
  for (const n of mdFiles(ctx.issuesDir)) {
    try {
      out.push(parseIssue(fs.readFileSync(path.join(ctx.issuesDir, n), "utf8"), n));
    } catch {
      /* malformed files are the plugin's business */
    }
  }
  return out;
}

export function loadProjects(ctx: Ctx): Project[] {
  const out: Project[] = [];
  for (const n of mdFiles(ctx.projectsDir)) {
    try {
      const p = parseProject(fs.readFileSync(path.join(ctx.projectsDir, n), "utf8"), n);
      if (p.name) out.push(p);
    } catch {
      /* skip */
    }
  }
  return out;
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function writeTemp(dir: string, text: string): string {
  const tmp = path.join(dir, `.kt-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`);
  fs.writeFileSync(tmp, text, "utf8");
  return tmp;
}

/** Atomic replace: temp file in the same folder, then rename (retried while Windows has it locked). */
export function atomicWrite(file: string, text: string): void {
  const tmp = writeTemp(path.dirname(file), text);
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i < 8 && (code === "EPERM" || code === "EBUSY" || code === "EACCES")) {
        sleep(25 * (i + 1));
        continue;
      }
      fs.rmSync(tmp, { force: true });
      throw e;
    }
  }
}

/** Atomic create: returns false when `file` already exists. */
export function atomicCreate(file: string, text: string): boolean {
  const tmp = writeTemp(path.dirname(file), text);
  try {
    fs.linkSync(tmp, file);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST" || fs.existsSync(file)) return false;
    fs.renameSync(tmp, file); // filesystem without hard links
    return true;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// ---- validation ----------------------------------------------------------

const ci = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

function normStatus(ctx: Ctx, v: string): string {
  const hit = ctx.settings.statuses.find((s) => ci(s.name, v));
  if (!hit) throw invalid(`Unknown status "${v}". Valid: ${ctx.settings.statuses.map((s) => s.name).join(", ")}`);
  return hit.name;
}

function normPriority(v: string): Priority {
  const hit = PRIORITY_ORDER.find((p) => ci(p, v));
  if (!hit) throw invalid(`Unknown priority "${v}". Valid: ${PRIORITY_ORDER.join(", ")}`);
  return hit;
}

function normDate(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  if (!m || !d || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) throw invalid(`Invalid date "${v}" (use YYYY-MM-DD).`);
  return v.trim();
}

function normProject(ctx: Ctx, v: string): Project {
  const name = fromLink(v);
  const projects = loadProjects(ctx);
  const hit = projects.find((p) => ci(p.name, name));
  if (!hit) throw invalid(`Unknown project "${name}". Valid: ${projects.map((p) => p.name).join(", ") || "(none)"}`);
  return hit;
}

function normMilestone(project: Project, v: string): string {
  const hit = project.milestones.find((m) => ci(m.name, v));
  if (!hit) throw invalid(`Unknown milestone "${v}" in project ${project.name}. Valid: ${project.milestones.map((m) => m.name).join(", ") || "(none)"}`);
  return hit.name;
}

export function normAuthor(v: string): string {
  const a = v.trim().replace(/^@/, "");
  if (a === "" || /\s/.test(a)) throw usage(`Invalid author "${v}" (no spaces).`);
  return a;
}

function normType(v: string): TicketType {
  const t = parseType(v);
  if (!t) throw invalid(`Invalid type "${v}" (expected ${TICKET_TYPES.join(" | ")}).`);
  return t;
}

function normModel(v: string): Model {
  const m = parseModel(v);
  if (!m) throw invalid(`Invalid model "${v}" (expected ${MODELS.join(" | ")}).`);
  return m;
}

function normOutcome(v: string): Outcome {
  const o = parseOutcome(v);
  if (!o) throw invalid(`Invalid outcome "${v}" (expected ${OUTCOMES.join(" | ")}).`);
  return o;
}

/** Turns a refused gate into a CLI error (exit code from the gate). */
function gateOrThrow(r: GateResult): void {
  if (!r.ok) throw new KtError(r.exitCode, r.message);
}

function normIssueRef(ctx: Ctx, v: string, what: string): string {
  const p = parseId(fromLink(v));
  if (!p) throw invalid(`Invalid ${what} "${v}" (expected an ID like ${ctx.settings.prefix}-1).`);
  return formatId(p.prefix.toUpperCase() === ctx.settings.prefix.toUpperCase() ? ctx.settings.prefix : p.prefix, p.n);
}

function findIssue(ctx: Ctx, idArg: string | undefined): { issue: Issue; file: string } {
  if (!idArg) throw usage("Missing issue ID.");
  const id = normIssueRef(ctx, idArg, "issue ID");
  const issue = loadIssues(ctx).find((i) => i.id === id);
  if (!issue) throw notFound(`Issue ${id} not found.`);
  return { issue, file: path.join(ctx.issuesDir, issue.fileName) };
}

const CLEAR = new Set(["", "none", "-"]);

// ---- argument parsing ----------------------------------------------------

// Tokens like "-frontend" or "- item" would be read as short options; hide the dash from parseArgs.
const DASH = "\u0001";
const hide = (a: string): string => (/^-[^-]/.test(a) ? DASH + a : a);
const show = (a: string): string => (a.startsWith(DASH) ? a.slice(1) : a);

type OptSpec = Record<string, { type: "string" | "boolean"; multiple?: boolean }>;
type Vals = Record<string, string | boolean | string[] | undefined>;

function parse(args: string[], options: OptSpec): { values: Vals; positionals: string[] } {
  try {
    const r = parseArgs({
      args: args.map(hide),
      options: { help: { type: "boolean" }, dir: { type: "string" }, ...options },
      allowPositionals: true,
      strict: true,
    });
    const values: Vals = {};
    for (const [k, v] of Object.entries(r.values)) {
      values[k] = typeof v === "string" ? show(v) : Array.isArray(v) ? v.map((x) => show(String(x))) : (v as boolean | undefined);
    }
    return { values, positionals: r.positionals.map(show) };
  } catch (e) {
    throw usage((e as Error).message);
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const list = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

// ---- help ----------------------------------------------------------------

const HELP: Record<string, string> = {
  main: `kt - kyle-tickets CLI

Usage: kt <command> [options]

Commands:
  new <title>            Create an issue; prints its ID (--agent: triage-only, deduped, capped)
  set <ID> <field> ...   Change a field (status, priority, assignee, project, milestone, due, parent, title, labels, type, repo, model, outcome, blockedBy)
  expire [--days <n>]    Cancel triage tickets untouched for n days (default 14)
  comment <ID> [text]    Add a comment (text "-" or omitted: read stdin); --reply-to <comment-id> replies
  list                   List issues
  show <ID>              Show an issue
  pr <ID> <url>          Link a GitHub pull request
  relate <ID> <OTHER>    Mark two issues as related (unrelate removes it)

Global options:
  --dir <path>           Tickets folder (else KT_DIR, else search upward for ${MARKER})
  --help                 Show help (also: kt <command> --help)

Exit codes: 0 ok, 1 usage error, 2 not found, 3 validation error.`,
  new: `Usage: kt new <title> [options]

  --status <name>        default: the vault's default status
  --priority <p>         urgent | high | medium | low | none
  --project <name>       --milestone <name> (needs a project)
  --parent <ID>          --assignee <name>   --due <YYYY-MM-DD>
  --label <name>         repeatable
  --description <text>   "-" reads stdin
  --type <t>             task | bug | plan | proposal | question | finding
  --repo <key>           settings repo map key
  --blocked-by <ID>      repeatable or comma-separated
  --model <m>            haiku | sonnet | opus
  --agent                agent mode (also KH_AGENT=1 or KH_RUN set)
  --as <author>          author of the "created the issue" event (default: KT_AUTHOR or the plugin display name)`,
  set: `Usage: kt set <ID> <field> <value> [--as <author>]

Fields: status, priority, assignee, project, milestone, due, parent, title
        labels +bug -frontend   (add / remove; several allowed)
Use "none" to clear assignee, project, milestone, due or parent.`,
  comment: "Usage: kt comment <ID> [text | -] [--as <author>] [--reply-to <comment-id>]",
  list: "Usage: kt list [--status <name>] [--project <name>] [--assignee <name>] [--label <name>] [--json]",
  show: "Usage: kt show <ID> [--json]",
  pr: "Usage: kt pr <ID> <github-pr-url> [--as <author>]",
  relate: "Usage: kt relate <ID> <OTHER-ID> [--as <author>]",
  unrelate: "Usage: kt unrelate <ID> <OTHER-ID> [--as <author>]",
};

// ---- commands ------------------------------------------------------------

export function authorOf(ctx: Ctx, io: Io, v: unknown): string {
  return normAuthor(str(v) ?? (io.env.KT_AUTHOR || ctx.settings.displayName || "kt"));
}

function cmdNew(args: string[], io: Io): void {
  const { values: v, positionals } = parse(args, {
    status: { type: "string" }, priority: { type: "string" }, project: { type: "string" }, milestone: { type: "string" },
    parent: { type: "string" }, assignee: { type: "string" }, due: { type: "string" }, label: { type: "string", multiple: true },
    description: { type: "string" }, as: { type: "string" },
    type: { type: "string" }, repo: { type: "string" }, "blocked-by": { type: "string", multiple: true },
    model: { type: "string" }, agent: { type: "boolean" }, fingerprint: { type: "string" },
  });
  if (positionals.length !== 1 || positionals[0]!.trim() === "") throw usage('Expected exactly one title: kt new "Title" [options]');
  const ctx = loadCtx(discoverFolder(str(v.dir), io));
  const who = authorOf(ctx, io, v.as);
  const now = io.now();
  const input: Parameters<typeof buildIssueText>[1] = { title: positionals[0]!.trim() };
  if (str(v.status) !== undefined) input.status = normStatus(ctx, str(v.status)!);
  if (str(v.priority) !== undefined) input.priority = normPriority(str(v.priority)!);
  if (str(v.assignee)) input.assignee = str(v.assignee)!.replace(/^@/, "");
  if (str(v.due) !== undefined) input.due = normDate(str(v.due)!);
  const labels = list(v.label).flatMap((l) => l.split(",")).map((l) => l.trim()).filter(Boolean);
  if (labels.length) input.tags = [...new Set(labels)];
  if (str(v.parent) !== undefined) {
    const pid = normIssueRef(ctx, str(v.parent)!, "parent");
    if (!loadIssues(ctx).some((i) => i.id === pid)) throw notFound(`Parent issue ${pid} not found.`);
    input.parent = pid;
  }
  if (str(v.project) !== undefined) {
    const proj = normProject(ctx, str(v.project)!);
    input.project = proj.name;
    if (str(v.milestone) !== undefined) input.milestone = normMilestone(proj, str(v.milestone)!);
  } else if (str(v.milestone) !== undefined) throw invalid("--milestone needs --project.");
  const desc = str(v.description);
  if (desc !== undefined) input.description = desc === "-" ? io.stdin() : desc;
  if (str(v.type) !== undefined) input.type = normType(str(v.type)!);
  if (str(v.model) !== undefined) input.model = normModel(str(v.model)!);
  if (str(v.repo)) input.repo = str(v.repo)!.trim();
  const blocked = list(v["blocked-by"]).flatMap((b) => b.split(",")).map((b) => b.trim()).filter(Boolean);
  if (blocked.length) input.blockedBy = blocked.map((b) => normIssueRef(ctx, b, "blocked-by"));

  if (isAgentMode(io.env, v.agent === true)) {
    const source = agentSource(io.env);
    const plan = planAgentCreate(
      { title: input.title, type: input.type, repo: input.repo, tags: input.tags, fingerprint: str(v.fingerprint) },
      { statuses: ctx.settings.statuses, issues: loadIssues(ctx), source, flood: ctx.flood },
    );
    if (!plan.ok) throw new KtError(plan.exitCode, plan.message);
    if (plan.duplicate) {
      const file = path.join(ctx.issuesDir, plan.duplicate.fileName);
      const text = appendComment(parseIssue(fs.readFileSync(file, "utf8"), plan.duplicate.fileName), { author: source, body: `seen again (+1) from ${source}` }, now);
      atomicWrite(file, text);
      io.out(plan.duplicate.id);
      return;
    }
    input.status = plan.status;
    input.source = source;
    input.fingerprint = plan.fingerprint;
  }

  fs.mkdirSync(ctx.issuesDir, { recursive: true });
  for (let attempt = 0; attempt < 20; attempt++) {
    const ids = [...loadIssues(ctx).map((i) => i.id), ...mdFiles(ctx.issuesDir).map((n) => n.replace(/\.md$/i, ""))];
    const { id } = nextId(Math.max(1, ctx.counter), ids, ctx.settings.prefix);
    const fileName = `${id}.md`;
    const base = buildIssueText(id, input, ctx.settings.defaultStatus, now);
    const text = appendEvent(parseIssue(base, fileName), { author: who, text: "created the issue" }, now);
    if (atomicCreate(path.join(ctx.issuesDir, fileName), text)) {
      io.out(id);
      return;
    }
  }
  throw invalid("Could not allocate a free issue ID.");
}

function cmdSet(args: string[], io: Io): void {
  const { values: v, positionals } = parse(args, { as: { type: "string" }, agent: { type: "boolean" } });
  const [idArg, fieldArg, ...rest] = positionals;
  if (!idArg || !fieldArg) throw usage("Usage: kt set <ID> <field> <value>");
  const ctx = loadCtx(discoverFolder(str(v.dir), io));
  const { issue, file } = findIssue(ctx, idArg);
  const who = authorOf(ctx, io, v.as);
  const agent = isAgentMode(io.env, v.agent === true);
  const field = fieldArg.toLowerCase();
  const patch: IssuePatch = {};
  const value = rest.join(" ").trim();
  const clearing = CLEAR.has(value.toLowerCase());
  if (field !== "labels" && field !== "label" && rest.length === 0) throw usage(`Missing value for ${field}.`);

  switch (field) {
    case "status": {
      const status = normStatus(ctx, value);
      if (agent) gateOrThrow(checkAgentStatus(status, ctx.settings.statuses));
      patch.status = status;
      break;
    }
    case "type": patch.type = clearing ? null : normType(value); break;
    case "repo": patch.repo = clearing ? null : value; break;
    case "model": patch.model = clearing ? null : normModel(value); break;
    case "outcome": patch.outcome = clearing ? null : normOutcome(value); break;
    case "blockedby":
      patch.blockedBy = value.split(/[\s,]+/).filter(Boolean).map((b) => normIssueRef(ctx, b, "blocked-by"));
      break;
    case "priority": patch.priority = normPriority(value); break;
    case "assignee": patch.assignee = clearing ? null : value.replace(/^@/, ""); break;
    case "due": patch.due = clearing ? null : normDate(value); break;
    case "title":
      if (value === "") throw invalid("Title cannot be empty.");
      patch.title = value;
      break;
    case "parent":
      if (clearing) patch.parent = null;
      else {
        const pid = normIssueRef(ctx, value, "parent");
        if (pid === issue.id) throw invalid("An issue cannot be its own parent.");
        if (!loadIssues(ctx).some((i) => i.id === pid)) throw notFound(`Parent issue ${pid} not found.`);
        patch.parent = pid;
      }
      break;
    case "project":
      if (clearing) {
        patch.project = null;
        if (issue.milestone) patch.milestone = null;
      } else {
        const proj = normProject(ctx, value);
        patch.project = proj.name;
        if (issue.milestone && milestoneAfterProjectChange(issue.milestone, proj) === undefined) patch.milestone = null;
      }
      break;
    case "milestone":
      if (clearing) patch.milestone = null;
      else {
        if (!issue.project) throw invalid(`${issue.id} has no project; set a project first.`);
        patch.milestone = normMilestone(normProject(ctx, issue.project), value);
      }
      break;
    case "labels":
    case "label": {
      if (rest.length === 0) throw usage("Usage: kt set <ID> labels +bug -frontend");
      let tags = [...issue.tags];
      for (const tok of rest) {
        const name = tok.replace(/^[+-]/, "").trim();
        if (name === "") throw usage(`Invalid label token "${tok}".`);
        if (tok.startsWith("-")) tags = tags.filter((t) => !ci(t, name));
        else {
          if (agent) gateOrThrow(checkAgentLabels([name]));
          if (!tags.some((t) => ci(t, name))) tags.push(name);
        }
      }
      patch.tags = tags;
      break;
    }
    default:
      throw usage(`Unknown field "${fieldArg}". Fields: status, priority, assignee, project, milestone, due, parent, title, labels, type, repo, model, outcome, blockedBy.`);
  }

  const text = fs.readFileSync(file, "utf8");
  const now = io.now();
  if (patchIssueText(text, issue.fileName, patch, who, now) === text) {
    io.out(`${issue.id} unchanged`);
    return;
  }
  const out = patchIssueText(text, issue.fileName, { ...patch, updatedBy: who }, who, now);
  atomicWrite(file, out);
  io.out(`${issue.id} updated`);
}

function cmdComment(args: string[], io: Io): void {
  const { values: v, positionals } = parse(args, { as: { type: "string" }, "reply-to": { type: "string" } });
  const [idArg, ...rest] = positionals;
  const ctx = loadCtx(discoverFolder(str(v.dir), io));
  const { issue, file } = findIssue(ctx, idArg);
  // A comment from a launched run authors as `agent:<KH_RUN>` so session end can tell it is the agent's summary.
  const who = str(v.as) === undefined && io.env.KH_RUN ? agentSource(io.env) : authorOf(ctx, io, v.as);
  const replyTo = str(v["reply-to"]);
  const body = rest.length === 0 || (rest.length === 1 && rest[0] === "-") ? io.stdin() : rest.join(" ");
  if (body.trim() === "") throw invalid("Comment body is empty.");
  const text = fs.readFileSync(file, "utf8");
  let out: string;
  try {
    out = replyTo ? addReplyText(text, issue.fileName, replyTo, who, body, io.now()) : commentIssueText(text, issue.fileName, who, body, io.now());
  } catch (e) {
    throw invalid(e instanceof Error ? e.message : String(e));
  }
  atomicWrite(file, out);
  io.out(replyTo ? `${issue.id} replied` : `${issue.id} commented`);
}

function cmdPr(args: string[], io: Io): void {
  const { values: v, positionals } = parse(args, { as: { type: "string" } });
  const [idArg, url] = positionals;
  if (!url || positionals.length !== 2) throw usage("Usage: kt pr <ID> <url>");
  const ctx = loadCtx(discoverFolder(str(v.dir), io));
  const { issue, file } = findIssue(ctx, idArg);
  const who = authorOf(ctx, io, v.as);
  let out: string | null;
  try {
    out = linkPrText(fs.readFileSync(file, "utf8"), issue.fileName, url, who, io.now());
  } catch (e) {
    throw invalid((e as Error).message);
  }
  if (out === null) {
    io.out(`${issue.id} already links that PR`);
    return;
  }
  atomicWrite(file, out);
  io.out(`${issue.id} linked PR`);
}

function cmdRelate(args: string[], io: Io, remove: boolean): void {
  const { values: v, positionals } = parse(args, { as: { type: "string" } });
  const name = remove ? "unrelate" : "relate";
  if (positionals.length !== 2) throw usage(`Usage: kt ${name} <ID> <OTHER-ID>`);
  const ctx = loadCtx(discoverFolder(str(v.dir), io));
  const { issue } = findIssue(ctx, positionals[0]);
  const { issue: other } = findIssue(ctx, positionals[1]);
  if (issue.id === other.id) throw invalid("An issue cannot be related to itself.");
  const who = authorOf(ctx, io, v.as);
  const all = loadIssues(ctx);
  const changes = remove
    ? removeRelatedLists(issue, other)
    : [addRelatedList(issue, other.id, all)].flatMap((related) => (related ? [{ id: issue.id, related }] : []));
  if (changes.length === 0) {
    io.out(`${issue.id} ${remove ? "not related to" : "already related to"} ${other.id}`);
    return;
  }
  for (const c of changes) {
    const target = all.find((i) => i.id === c.id)!;
    const file = path.join(ctx.issuesDir, target.fileName);
    atomicWrite(file, patchIssueText(fs.readFileSync(file, "utf8"), target.fileName, { related: c.related, updatedBy: who }, who, io.now()));
  }
  io.out(`${issue.id} ${remove ? "unrelated from" : "related to"} ${other.id}`);
}

const byId = (a: Issue, b: Issue): number => a.id.localeCompare(b.id, undefined, { numeric: true });

function cmdList(args: string[], io: Io): void {
  const { values: v, positionals } = parse(args, {
    status: { type: "string" }, project: { type: "string" }, assignee: { type: "string" }, label: { type: "string", multiple: true }, json: { type: "boolean" },
  });
  if (positionals.length) throw usage(`Unexpected argument "${positionals[0]}".`);
  const ctx = loadCtx(discoverFolder(str(v.dir), io));
  let issues = loadIssues(ctx);
  if (str(v.status) !== undefined) {
    const s = normStatus(ctx, str(v.status)!);
    issues = issues.filter((i) => i.status === s);
  }
  if (str(v.project) !== undefined) {
    const p = fromLink(str(v.project)!);
    issues = issues.filter((i) => i.project !== undefined && ci(fromLink(i.project), p));
  }
  if (str(v.assignee) !== undefined) {
    const a = str(v.assignee)!.replace(/^@/, "");
    issues = issues.filter((i) => i.assignee !== undefined && ci(i.assignee, a));
  }
  for (const l of list(v.label)) issues = issues.filter((i) => i.tags.some((t) => ci(t, l)));
  issues.sort(byId);
  if (v.json) {
    io.out(JSON.stringify(issues.map(issueToJson), null, 2));
    return;
  }
  if (issues.length === 0) {
    io.out("No issues.");
    return;
  }
  const w = (f: (i: Issue) => string): number => Math.max(...issues.map((i) => f(i).length));
  const wi = w((i) => i.id);
  const ws = w((i) => i.status);
  const wp = w((i) => i.priority);
  for (const i of issues) io.out(`${i.id.padEnd(wi)}  ${i.status.padEnd(ws)}  ${i.priority.padEnd(wp)}  ${i.title}`);
}

function cmdShow(args: string[], io: Io): void {
  const { values: v, positionals } = parse(args, { json: { type: "boolean" } });
  if (positionals.length !== 1) throw usage("Usage: kt show <ID>");
  const ctx = loadCtx(discoverFolder(str(v.dir), io));
  const { issue: i } = findIssue(ctx, positionals[0]);
  const j = issueToJson(i);
  if (v.json) {
    io.out(JSON.stringify(j, null, 2));
    return;
  }
  const rows: [string, unknown][] = [
    ["Status", j.status], ["Priority", j.priority], ["Assignee", j.assignee], ["Project", j.project], ["Milestone", j.milestone],
    ["Labels", i.tags.join(", ") || null], ["Due", j.due], ["Parent", j.parent], ["PRs", i.pullRequests.join(", ") || null], ["Related", relatedIds(i, loadIssues(ctx)).join(", ") || null],
    ["Created", j.created], ["Updated", j.updated],
  ];
  io.out(`${i.id}  ${i.title}`);
  for (const [k, val] of rows) if (val !== null && val !== undefined) io.out(`${k}: ${String(val)}`);
  if (i.description) io.out(`\n${i.description}`);
  if (i.feed.length) {
    io.out("\nActivity");
    for (const f of i.feed) {
      if (f.type === "event") io.out(`- ${f.time} @${f.author} ${f.text}`);
      else io.out(`\n@${f.author} ${f.time}\n${f.body}\n`);
    }
  }
}

/** Cancels triage tickets untouched for `--days` (default 14); each gets an `expired` event. */
function cmdExpire(args: string[], io: Io): void {
  const { values: v } = parse(args, { as: { type: "string" }, days: { type: "string" } });
  const ctx = loadCtx(discoverFolder(str(v.dir), io));
  const days = str(v.days) === undefined ? ctx.flood.expireDays : Number(str(v.days));
  if (!Number.isFinite(days) || days <= 0) throw invalid(`Invalid --days "${str(v.days)}".`);
  const canceled = ctx.settings.statuses.find((s) => s.category === "canceled");
  if (!canceled) throw invalid("No canceled-category status to expire into.");
  const who = authorOf(ctx, io, v.as);
  const now = io.now();
  const stale = expiredTriage(loadIssues(ctx), ctx.settings.statuses, now, days);
  for (const issue of stale) {
    const file = path.join(ctx.issuesDir, issue.fileName);
    const patched = patchIssueText(fs.readFileSync(file, "utf8"), issue.fileName, { status: canceled.name }, who, now);
    atomicWrite(file, appendEvent(parseIssue(patched, issue.fileName), { author: who, text: `expired (no update for ${days} days)` }, now));
    io.out(`${issue.id} expired`);
  }
  if (stale.length === 0) io.out("0 expired");
}

const COMMANDS: Record<string, (args: string[], io: Io) => void> = {
  expire: cmdExpire, new: cmdNew, set: cmdSet, comment: cmdComment, list: cmdList, show: cmdShow, pr: cmdPr, relate: (a, io) => cmdRelate(a, io, false), unrelate: (a, io) => cmdRelate(a, io, true),
};

/** Runs the CLI; returns the process exit code. */
export function run(argv: string[], io: Io): number {
  try {
    const [cmd, ...rest] = argv;
    if (cmd === undefined) {
      io.err(HELP.main!);
      return EXIT.usage;
    }
    if (cmd === "--help" || cmd === "-h" || cmd === "help") {
      io.out(HELP.main!);
      return EXIT.ok;
    }
    const fn = COMMANDS[cmd];
    if (!fn) throw usage(`Unknown command "${cmd}". Run kt --help.`);
    if (rest.includes("--help")) {
      io.out(HELP[cmd]!);
      return EXIT.ok;
    }
    fn(rest, io);
    return EXIT.ok;
  } catch (e) {
    if (e instanceof KtError) {
      io.err(`kt: ${e.message}`);
      return e.code;
    }
    io.err(`kt: ${(e as Error).message}`);
    return EXIT.validation;
  }
}
