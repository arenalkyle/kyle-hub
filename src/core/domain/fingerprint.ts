import { createHash } from "node:crypto";

/** Lowercase, drop ticket ids (`LOCK-47`) and numbers, strip punctuation, collapse whitespace. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\b[a-z]{2,}-\d+\b/g, " ")
    .replace(/\d+/g, " ")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** sha1 of `type + repo + normalized title`, first 12 hex chars. */
export function fingerprintOf(input: { type: string; repo?: string; title: string }): string {
  const key = [input.type, input.repo ?? "", normalizeTitle(input.title)].join("\n");
  return createHash("sha1").update(key).digest("hex").slice(0, 12);
}
