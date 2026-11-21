import { Document, isMap, isSeq, parseDocument } from "yaml";

export interface SplitFile {
  frontmatterText: string;
  body: string;
  eol: string;
}

/** Split `---` fenced frontmatter from the body. Throws if there is none. */
export function splitFrontmatter(text: string): SplitFile {
  const m = /^---[ \t]*(\r?\n)(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) throw new Error("File has no frontmatter");
  return { frontmatterText: m[2] ?? "", body: text.slice(m[0].length), eol: m[1]! };
}

export function parseFrontmatter(frontmatterText: string): Document {
  const doc = parseDocument(frontmatterText);
  if (doc.errors.length > 0) throw new Error(`Invalid frontmatter: ${doc.errors[0]!.message}`);
  if (doc.contents !== null && !isMap(doc.contents)) {
    throw new Error("Frontmatter must be a YAML mapping");
  }
  return doc;
}

export function fmToJs(doc: Document): Record<string, unknown> {
  const v = doc.toJS() as unknown;
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * Write `desired` into a clone of `doc`, touching only keys whose value differs
 * from `baseline` (the same fields derived from the unmodified doc). Empty values
 * and values equal to `defaults[key]` delete the key. Returns the original text
 * untouched when nothing differs. Note: when something does differ the frontmatter is
 * re-serialized by `yaml`, which keeps key order, values and comments but normalises
 * spacing/quoting. `flowKeys` get `[a, b]` style when (re)written.
 */
export function syncFrontmatter(
  doc: Document,
  originalText: string,
  desired: Record<string, unknown>,
  baseline: Record<string, unknown>,
  defaults: Record<string, unknown> = {},
  flowKeys: readonly string[] = [],
): string {
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  let next: Document | null = null;
  for (const [k, want] of Object.entries(desired)) {
    if (same(want, baseline[k])) continue;
    next ??= doc.clone();
    if (isEmpty(want) || want === defaults[k]) next.delete(k);
    else {
      const node = next.createNode(want);
      if (isSeq(node) && flowKeys.includes(k)) node.flow = true;
      next.set(k, node);
    }
  }
  if (!next) return originalText;
  return next.toString({ lineWidth: 0, flowCollectionPadding: false }).replace(/\r?\n$/, "");
}

export function str(v: unknown): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  return String(v);
}

export function strList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v) return [v];
  return [];
}

export function assemble(frontmatterText: string, eol: string, body: string): string {
  const fm = frontmatterText === "" ? "" : frontmatterText + eol;
  return `---${eol}${fm}---${eol}${body}`;
}
