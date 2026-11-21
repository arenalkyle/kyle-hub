import {
  assemble,
  fmToJs,
  parseFrontmatter,
  splitFrontmatter,
  str,
  strList,
  syncFrontmatter,
} from "./frontmatter";
import { formatFeedTime, formatIso } from "./time";
import type { ActivityEvent, Comment, FeedEntry, Issue, Priority } from "./types";

const PRIORITIES: readonly Priority[] = ["none", "urgent", "high", "medium", "low"];
const FEED_HEADING = /^##[ \t]+Activity[ \t]*$/;
const TIME = String.raw`(\d{4}-\d{2}-\d{2} \d{2}:\d{2})`;
const SEP = String.raw`[·—-]`;
const COMMENT_HEAD = new RegExp(
  String.raw`^###[ \t]+@(\S+)[ \t]+${SEP}[ \t]+${TIME}(?:[ \t]+<!--[ \t]*kt((?:[ \t]+[a-z]+(?::[\w-]+)?)*)[ \t]*-->)?[ \t]*$`,
);
const EVENT_LINE = new RegExp(String.raw`^-[ \t]+${TIME}[ \t]+${SEP}[ \t]+@(\S+)(?:[ \t]+(.*))?$`);

type Fields = Record<string, unknown>;

/** Normalised frontmatter-backed fields, shared by parse (and as the sync baseline). */
function fieldsFromFm(fm: Fields, fileName: string): Fields {
  const id = str(fm.id) ?? fileName.replace(/\.md$/i, "");
  const p = str(fm.priority)?.toLowerCase();
  const so = fm.sortOrder === undefined ? NaN : Number(fm.sortOrder);
  return {
    id,
    title: str(fm.title) ?? id,
    aliases: strList(fm.aliases),
    status: str(fm.status) ?? "",
    priority: (PRIORITIES as readonly string[]).includes(p ?? "") ? p : "none",
    assignee: str(fm.assignee),
    project: str(fm.project),
    milestone: str(fm.milestone),
    tags: strList(fm.tags),
    due: str(fm.due),
    parent: str(fm.parent),
    pullRequests: strList(fm.pullRequests),
    created: str(fm.created),
    updated: str(fm.updated),
    updatedBy: str(fm.updatedBy),
    sortOrder: Number.isFinite(so) ? so : undefined,
  };
}

const FIELD_KEYS = Object.keys(fieldsFromFm({}, ""));

/** Body lines that would be read as feed structure are escaped with a leading backslash in files. */
const STRUCTURAL = String.raw`(###|- \d{4}-\d{2}-\d{2} \d{2}:\d{2} )`;
const ESCAPE_LINE = new RegExp(String.raw`^\\*${STRUCTURAL}`);
const UNESCAPE_LINE = new RegExp(String.raw`^\\+${STRUCTURAL}`);

/** Escape comment-body lines that start a `###` heading or an event bullet (adds one backslash). */
export function escapeCommentBody(body: string): string {
  return body.split(/\r?\n/).map((l) => (ESCAPE_LINE.test(l) ? `\\${l}` : l)).join("\n");
}

/** Inverse of {@link escapeCommentBody}: removes one leading backslash from escaped structural lines. */
export function unescapeCommentBody(body: string): string {
  return body.split("\n").map((l) => (UNESCAPE_LINE.test(l) ? l.slice(1) : l)).join("\n");
}

function trimBlankEdges(s: string): string {
  return s.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/(?:\r?\n[ \t]*)+$/, "");
}

interface Meta {
  id?: string;
  reply?: string;
  edited: boolean;
}

function parseMeta(raw: string | undefined): Meta {
  const m: Meta = { edited: false };
  for (const tok of (raw ?? "").trim().split(/\s+/)) {
    if (tok === "edited") m.edited = true;
    else if (tok.startsWith("id:")) m.id = tok.slice(3);
    else if (tok.startsWith("reply:")) m.reply = tok.slice(6);
  }
  return m;
}

function metaSuffix(m: Meta): string {
  const t = [m.id ? `id:${m.id}` : "", m.reply ? `reply:${m.reply}` : "", m.edited ? "edited" : ""].filter(Boolean);
  return t.length === 0 ? "" : ` <!-- kt ${t.join(" ")} -->`;
}

const LEGACY_ID = /^L\d+$/;

export function parseFeed(feedRaw: string | null): FeedEntry[] {
  if (feedRaw === null) return [];
  const lines = feedRaw.split(/\r?\n/).slice(1); // skip heading
  const feed: FeedEntry[] = [];
  let cur: { author: string; time: string; meta: Meta; body: string[] } | null = null;
  let n = 0;
  const flush = (): void => {
    if (cur) {
      const c: Comment = {
        type: "comment",
        author: cur.author,
        time: cur.time,
        body: unescapeCommentBody(trimBlankEdges(cur.body.join("\n"))),
        id: cur.meta.id ?? `L${n}`,
      };
      if (cur.meta.reply) c.replyTo = cur.meta.reply;
      if (cur.meta.edited) c.edited = true;
      feed.push(c);
      n++;
      cur = null;
    }
  };
  for (const line of lines) {
    const head = COMMENT_HEAD.exec(line);
    if (head) {
      flush();
      cur = { author: head[1]!, time: head[2]!, meta: parseMeta(head[3]), body: [] };
      continue;
    }
    if (/^###/.test(line)) {
      flush(); // other ### headings are junk: kept in raw, not in the feed
      continue;
    }
    const ev = EVENT_LINE.exec(line);
    if (ev) {
      flush();
      feed.push({ type: "event", time: ev[1]!, author: ev[2]!, text: ev[3] ?? "" });
      continue;
    }
    if (cur) (cur as { body: string[] }).body.push(line);
  }
  flush();
  return feed;
}

export function parseIssue(text: string, fileName: string): Issue {
  const { frontmatterText, body, eol } = splitFrontmatter(text);
  const doc = parseFrontmatter(frontmatterText);
  const f = fieldsFromFm(fmToJs(doc), fileName);

  const lines = body.split(/(?<=\n)/); // keep terminators
  const idx = lines.findIndex((l) => FEED_HEADING.test(l.replace(/\r?\n$/, "")));
  const descriptionRaw = idx < 0 ? body : lines.slice(0, idx).join("");
  const feedRaw = idx < 0 ? null : lines.slice(idx).join("");

  return {
    ...(f as Omit<Issue, "fileName" | "description" | "feed" | "raw">),
    fileName,
    description: trimBlankEdges(descriptionRaw),
    feed: parseFeed(feedRaw),
    raw: { frontmatterText, doc, descriptionRaw, feedRaw, eol },
  };
}

function issueFields(issue: Issue): Fields {
  const out: Fields = {};
  for (const k of FIELD_KEYS) out[k] = (issue as unknown as Fields)[k];
  return out;
}

function renderBody(issue: Issue): { description: string; feed: string | null } {
  const { raw } = issue;
  let description = raw.descriptionRaw;
  if (issue.description !== trimBlankEdges(raw.descriptionRaw)) {
    const e = raw.eol;
    description = issue.description === "" ? "" : issue.description + e;
    if (raw.feedRaw !== null && description !== "") description += e;
  }
  return { description, feed: raw.feedRaw };
}

export function serializeIssue(issue: Issue): string {
  const { description, feed } = renderBody(issue);
  return assemble(serializeFrontmatterOnly(issue), issue.raw.eol, description + (feed ?? ""));
}

function appendToFeed(issue: Issue, entry: string, isEvent: boolean): string {
  const e = issue.raw.eol;
  let { description, feed } = renderBody(issue);
  if (feed === null) {
    if (description !== "") {
      if (!description.endsWith("\n")) description += e;
      if (!description.endsWith(e + e) && description !== e) description += e;
    }
    feed = `## Activity${e}${e}`;
  } else {
    if (!feed.endsWith("\n")) feed += e;
    const last = feed.replace(/\r?\n$/, "").split(/\r?\n/).pop() ?? "";
    const isBlank = last.trim() === "";
    if (!isBlank && !(isEvent && EVENT_LINE.test(last))) feed += e;
  }
  const fm = serializeFrontmatterOnly(issue);
  return assemble(fm, e, description + feed + entry + e);
}

function serializeFrontmatterOnly(issue: Issue): string {
  const { raw } = issue;
  const baseline = fieldsFromFm(fmToJs(raw.doc), issue.fileName);
  return syncFrontmatter(raw.doc, raw.frontmatterText, issueFields(issue), baseline, {
    priority: "none",
  }, ["aliases", "tags"]);
}

/** Append a comment; returns the new file text. Pure: pass `now` explicitly. */
export function appendComment(
  issue: Issue,
  input: { author: string; body: string; id?: string; replyTo?: string },
  now: Date,
): string {
  const e = issue.raw.eol;
  const body = escapeCommentBody(trimBlankEdges(input.body)).replace(/\n/g, e);
  const head = `### @${input.author} · ${formatFeedTime(now)}${metaSuffix({ id: input.id, reply: input.replyTo, edited: false })}`;
  return appendToFeed(issue, body === "" ? head : head + e + body, false);
}

/** Fresh comment id (`c` + 6 base36 chars) that does not collide with existing ids. */
export function newCommentId(issue: Issue, now: Date): string {
  const used = new Set(issue.feed.flatMap((f) => (f.type === "comment" ? [f.id] : [])));
  let t = now.getTime();
  for (;;) {
    const id = "c" + (t % 2 ** 31).toString(36).padStart(6, "0").slice(-6);
    if (!used.has(id)) return id;
    t++;
  }
}

/** Raw line range of the nth comment: head line through the end of its body (trailing blank lines excluded). */
function locateComment(feedRaw: string, index: number): { lines: string[]; start: number; end: number } | null {
  const lines = feedRaw.split(/(?<=\n)/);
  const strip = (l: string): string => l.replace(/\r?\n$/, "");
  let n = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!COMMENT_HEAD.test(strip(lines[i]!))) continue;
    if (++n !== index) continue;
    let end = i + 1;
    while (end < lines.length && !/^###/.test(strip(lines[end]!)) && !EVENT_LINE.test(strip(lines[end]!))) end++;
    while (end > i + 1 && strip(lines[end - 1]!).trim() === "") end--;
    return { lines, start: i, end };
  }
  return null;
}

/** Rewrites one comment's heading meta and optionally its body; everything else stays byte-identical. */
function rewriteComment(issue: Issue, id: string, change: (c: Comment) => { meta: Meta; body?: string }): string {
  const comments = issue.feed.filter((f): f is Comment => f.type === "comment");
  const idx = comments.findIndex((c) => c.id === id);
  const c = comments[idx];
  const loc = c && issue.raw.feedRaw !== null ? locateComment(issue.raw.feedRaw, idx) : null;
  if (!c || !loc) throw new Error(`No comment with id ${id}.`);
  const e = issue.raw.eol;
  const { meta, body } = change(c);
  const term = (l: string): string => /\r?\n$/.exec(l)?.[0] ?? "";
  const head = `### @${c.author} · ${c.time}${metaSuffix(meta)}`;
  let text: string;
  if (body === undefined) {
    text = head + term(loc.lines[loc.start]!) + loc.lines.slice(loc.start + 1, loc.end).join("");
  } else {
    const b = escapeCommentBody(trimBlankEdges(body)).replace(/\n/g, e);
    text = (b === "" ? head : head + e + b) + term(loc.lines[loc.end - 1]!);
  }
  const feed = loc.lines.slice(0, loc.start).join("") + text + loc.lines.slice(loc.end).join("");
  return assemble(serializeFrontmatterOnly(issue), e, renderBody(issue).description + feed);
}

const metaOf = (c: Comment): Meta => ({ id: LEGACY_ID.test(c.id) ? undefined : c.id, reply: c.replyTo, edited: c.edited === true });

/** Replace a comment's body and mark it edited. Returns file text. */
export function editCommentText(issue: Issue, id: string, body: string): string {
  return rewriteComment(issue, id, (c) => ({ meta: { ...metaOf(c), edited: true }, body }));
}

/** Writes an explicit id into a (legacy) comment's heading. Returns file text. */
export function materializeCommentId(issue: Issue, id: string, newId: string): string {
  return rewriteComment(issue, id, (c) => ({ meta: { ...metaOf(c), id: newId } }));
}

/** Append an event bullet; returns the new file text. */
export function appendEvent(
  issue: Issue,
  input: { author: string; text: string },
  now: Date,
): string {
  return appendToFeed(issue, `- ${formatFeedTime(now)} · @${input.author} ${input.text}`.trimEnd(), true);
}

export type IssuePatch = Partial<
  Pick<Issue, "title" | "status" | "priority" | "tags" | "pullRequests" | "description" | "sortOrder">
> & {
  assignee?: string | null;
  project?: string | null;
  milestone?: string | null;
  due?: string | null;
  parent?: string | null;
  updatedBy?: string | null;
  sortOrder?: number | null;
};

/** Returns a new issue with fields changed, `updated` bumped and `aliases` synced to `title`. */
export function applyPatch(issue: Issue, patch: IssuePatch, now: Date): Issue {
  const next: Issue = { ...issue, tags: [...issue.tags], pullRequests: [...issue.pullRequests] };
  const bag = next as unknown as Fields;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    bag[k] = v === null ? undefined : v;
  }
  if (patch.title !== undefined && patch.title !== issue.title) {
    const old = issue.aliases.includes(issue.title);
    next.aliases = old
      ? issue.aliases.map((a) => (a === issue.title ? patch.title! : a))
      : [patch.title, ...issue.aliases];
  }
  next.updated = formatIso(now);
  return next;
}

export type { ActivityEvent, Comment };
