import { appendComment, appendEvent, applyPatch, parseIssue, serializeIssue } from "./issueFile";
import type { IssuePatch } from "./issueFile";
import { diffToEvents } from "./diff";
import { fromLink } from "./links";
import { asLink } from "./create";
import { parsePrUrl, prLabelOfUrl } from "./pr";
import type { Issue } from "./types";

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
    feed: i.feed.map((f) => (f.type === "comment" ? { type: "comment", author: f.author, time: f.time, body: f.body } : { type: "event", author: f.author, time: f.time, text: f.text })),
  };
}
