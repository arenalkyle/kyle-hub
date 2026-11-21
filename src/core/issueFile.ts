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
const COMMENT_HEAD = new RegExp(String.raw`^###[ \t]+@(\S+)[ \t]+${SEP}[ \t]+${TIME}[ \t]*$`);
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

function trimBlankEdges(s: string): string {
  return s.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/(?:\r?\n[ \t]*)+$/, "");
}

export function parseFeed(feedRaw: string | null): FeedEntry[] {
  if (feedRaw === null) return [];
  const lines = feedRaw.split(/\r?\n/).slice(1); // skip heading
  const feed: FeedEntry[] = [];
  let cur: { author: string; time: string; body: string[] } | null = null;
  const flush = (): void => {
    if (cur) {
      feed.push({
        type: "comment",
        author: cur.author,
        time: cur.time,
        body: trimBlankEdges(cur.body.join("\n")),
      });
      cur = null;
    }
  };
  for (const line of lines) {
    const head = COMMENT_HEAD.exec(line);
    if (head) {
      flush();
      cur = { author: head[1]!, time: head[2]!, body: [] };
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
  input: { author: string; body: string },
  now: Date,
): string {
  const e = issue.raw.eol;
  const body = trimBlankEdges(input.body).replace(/\r?\n/g, e);
  const head = `### @${input.author} · ${formatFeedTime(now)}`;
  return appendToFeed(issue, body === "" ? head : head + e + body, false);
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
