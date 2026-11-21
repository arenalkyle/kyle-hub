import { createTwoFilesPatch } from "diff";
import { fmToJs, parseFrontmatter, splitFrontmatter } from "./frontmatter";
import { DEFAULT_PUBLIC_HOSTS, scrub, type ScrubOptions, type ScrubResult } from "./scrub";

export interface PromotePlan {
  /** Path under the home vault, forward slashes (`Brain/lessons/<name>.md`). */
  targetRel: string;
  before: string;
  after: string;
  /** Unified diff of before -> after. */
  diff: string;
  counts: ScrubResult["counts"];
  changed: boolean;
}

/** Work docs that may be promoted: a `lesson` doc, or a `proposal` ticket carrying the `applied` tag. */
export function promoteEligible(text: string): { ok: true } | { ok: false; reason: string } {
  let fm: Record<string, unknown> = {};
  try {
    fm = fmToJs(parseFrontmatter(splitFrontmatter(text).frontmatterText));
  } catch {
    return { ok: false, reason: "The file has no readable frontmatter." };
  }
  const type = typeof fm.type === "string" ? fm.type : "";
  if (type === "lesson") return { ok: true };
  if (type === "proposal") {
    const tags = Array.isArray(fm.tags) ? fm.tags.map(String) : [];
    return tags.includes("applied") ? { ok: true } : { ok: false, reason: "This proposal has not been applied." };
  }
  return { ok: false, reason: "Only lesson docs and applied proposal tickets can be promoted." };
}

/** File name for the promoted note (`<base>.md`, safe characters only). */
export function promoteFileName(sourceName: string): string {
  const base = sourceName
    .replace(/\.md$/i, "")
    .replace(/[^A-Za-z0-9._ -]+/g, "-")
    .replace(/^[-. ]+|[-. ]+$/g, "");
  return `${base || "lesson"}.md`;
}

export function planPromote(sourceName: string, text: string, opts: ScrubOptions): PromotePlan {
  const r = scrub(text, opts);
  const name = promoteFileName(sourceName);
  const patch = createTwoFilesPatch(`work/${name}`, `home/Brain/lessons/${name}`, text, r.text, undefined, undefined, { context: 3 });
  return {
    targetRel: `Brain/lessons/${name}`,
    before: text,
    after: r.text,
    diff: patch.replace(/^=+\r?\n/, ""),
    counts: r.counts,
    changed: r.text !== text,
  };
}

/** Scrub options from settings: user terms plus every repo-map key and GitHub org. */
export function scrubOptionsFrom(
  promote: { publicHosts?: unknown; denylist?: unknown } | undefined,
  repos: Record<string, { github?: unknown } | undefined> | undefined,
): ScrubOptions {
  const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const orgs = Object.values(repos ?? {}).flatMap((r) => (typeof r?.github === "string" && r.github.includes("/") ? [r.github.split("/")[0]!] : []));
  const hosts = strs(promote?.publicHosts);
  return {
    repoNames: Object.keys(repos ?? {}),
    publicHosts: hosts.length > 0 ? hosts : DEFAULT_PUBLIC_HOSTS,
    denylist: [...strs(promote?.denylist), ...orgs],
  };
}
