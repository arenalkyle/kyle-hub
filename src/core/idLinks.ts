export interface IdMatch {
  id: string;
  index: number;
  length: number;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Finds whole issue IDs (`<prefix>-<digits>`, case-sensitive) in `text`.
 * Not matched: IDs glued to word characters or hyphens on either side (`XTIX-1`, `TIX-1a`, `FOO-TIX-1`),
 * and IDs inside a `[[wikilink]]`. A trailing `.`, `,`, `)` etc. still matches.
 */
export function findIdMatches(text: string, prefix: string): IdMatch[] {
  if (prefix === "") return [];
  const re = new RegExp(`(?<!\\[\\[)(?<![\\w-])(${escapeRe(prefix)}-\\d+)(?!\\w)`, "g");
  const out: IdMatch[] = [];
  for (const m of text.matchAll(re)) {
    out.push({ id: m[1]!, index: m.index, length: m[1]!.length });
  }
  return out;
}
