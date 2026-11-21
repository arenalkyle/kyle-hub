import {
  appendComment,
  appendEvent,
  applyPatch,
  editCommentText,
  materializeCommentId,
  newCommentId,
  parseIssue,
  serializeIssue,
} from "./issueFile";
import type { IssuePatch } from "./issueFile";
import { diffToEvents } from "./diff";
import { fromLink } from "./links";
import { asLink } from "./create";
import { parsePrUrl, prLabelOfUrl } from "./pr";
import type { Comment, Issue } from "./types";

const LEGACY = /^L\d+$/;
const strip = (a: string): string => a.replace(/^@/, "");

/**
 * Applies `patch` to ticket file text and returns the new text with one activity event per
 * changed tracked field. Returns `text` unchanged for a no-op patch. Shared by IssueStore and the kt CLI.
 */
export function patchIssueText(text: string, fileName: string, patch: IssuePatch, author: string, now: Date): string {
  const norm: IssuePatch = { ...patch };
  if (typeof norm.project === "string") norm.project = asLink(norm.project);
  if (typeof norm.parent === "string") norm.parent = asLink(norm.parent);
  const before = parseIssue(text, fileName);
  const after = applyPatch(before, norm, now);
  const events = diffToEvents(before, after, author, now);
  if (events.length === 0 && serializeIssue({ ...after, updated: before.updated }) === text) return text;
  let out = serializeIssue(after);
  for (const e of events) out = appendEvent(parseIssue(out, fileName), { author: e.author, text: e.text }, now);
  return out;
}

/** Comment appended with `updated` bumped. */
export function commentIssueText(text: string, fileName: string, author: string, body: string, now: Date): string {
  const bumped = applyPatch(parseIssue(text, fileName), {}, now);
  return appendComment(bumped, { author: strip(author), body }, now);
}

/**
 * Reply to a comment (one thread level: replying to a reply targets its root). A legacy parent
 * without an explicit id gets one written into its heading. Throws when `parentId` is unknown.
 */
export function addReplyText(text: string, fileName: string, parentId: string, author: string, body: string, now: Date): string {
  let issue = parseIssue(text, fileName);
  const comments = issue.feed.filter((f): f is Comment => f.type === "comment");
  let parent = comments.find((c) => c.id === parentId);
  if (!parent) throw new Error(`No comment with id ${parentId}.`);
  const root = parent.replyTo ? comments.find((c) => c.id === parent!.replyTo) : undefined;
  if (root) parent = root;
  let pid = parent.id;
  if (LEGACY.test(pid)) {
    pid = newCommentId(issue, now);
    issue = parseIssue(materializeCommentId(issue, parent.id, pid), fileName);
  }
  const bumped = applyPatch(issue, {}, now);
  return appendComment(bumped, { author: strip(author), body, id: newCommentId(issue, now), replyTo: pid }, now);
}

/** Replace a comment body (marks it `edited`) and bump `updated`. Throws when `id` is unknown. */
export function editCommentIssueText(text: string, fileName: string, id: string, body: string, now: Date): string {
  const edited = parseIssue(editCommentText(parseIssue(text, fileName), id, body), fileName);
  return serializeIssue(applyPatch(edited, {}, now));
}

/**
 * Adds a PR url (canonicalised, de-duplicated) and logs `linked PR owner/repo#N`.
 * Returns `null` when the url is already linked; throws when it is not a GitHub PR URL.
 */
export function linkPrText(text: string, fileName: string, url: string, author: string, now: Date): string | null {
  const ref = parsePrUrl(url);
  if (!ref) throw new Error("Not a GitHub pull request URL (https://github.com/owner/repo/pull/123).");
  const before = parseIssue(text, fileName);
  const key = (u: string): string => parsePrUrl(u)?.url ?? u;
  if (before.pullRequests.some((u) => key(u) === ref.url)) return null;
  const next = [...before.pullRequests, ref.url];
  const base = parseIssue(serializeIssue(applyPatch(before, { pullRequests: next }, now)), fileName);
  return appendEvent(base, { author: strip(author), text: `linked PR ${prLabelOfUrl(ref.url)}` }, now);
}

/** Plain JSON shape of an issue (no parser internals), used by `kt list/show --json`. */
export function issueToJson(i: Issue): Record<string, unknown> {
  return {
    id: i.id,
    title: i.title,
    status: i.status,
    priority: i.priority,
    assignee: i.assignee ?? null,
    project: i.project ? fromLink(i.project) : null,
    milestone: i.milestone ?? null,
    labels: i.tags,
    due: i.due ?? null,
    parent: i.parent ? fromLink(i.parent) : null,
    pullRequests: i.pullRequests,
    created: i.created ?? null,
    updated: i.updated ?? null,
    updatedBy: i.updatedBy ?? null,
    description: i.description,
    feed: i.feed.map((f) => (f.type === "comment" ? { type: "comment", id: f.id, replyTo: f.replyTo ?? null, edited: f.edited === true, author: f.author, time: f.time, body: f.body } : { type: "event", author: f.author, time: f.time, text: f.text })),
  };
}
