/** Deterministic scrubber for Promote (work -> home). Pure: no I/O, no network, no AI (ADR-0001). */

export type ScrubCategory = "email" | "url" | "path" | "host" | "repo" | "denylist";

export interface ScrubOptions {
  /** Repo-map keys, replaced with `<repo>`. */
  repoNames?: readonly string[];
  /** A host (or any subdomain of it) in this list is public: its URLs and name are kept. */
  publicHosts?: readonly string[];
  /** User terms, replaced with `<term>`. */
  denylist?: readonly string[];
}

export interface ScrubResult {
  text: string;
  /** Replacements per category (only categories that fired). */
  counts: Partial<Record<ScrubCategory, number>>;
}

export const DEFAULT_PUBLIC_HOSTS: readonly string[] = [
  "github.com",
  "npmjs.com",
  "docs.anthropic.com",
  "learn.microsoft.com",
  "developer.mozilla.org",
  "stackoverflow.com",
];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`)\]]+/gi;
// Windows drive paths, UNC paths, and unix absolute paths under well-known roots.
const PATH_RE = /[A-Za-z]:[\\/][^\s<>"'`)\]|*?:]*|\\\\[A-Za-z0-9_.-]+\\[^\s<>"'`)\]|*?:]*|(?<![\w./-])\/(?:home|Users|var|etc|opt|srv|mnt|usr|tmp|root|workspace|app)\/[^\s<>"'`)\]:]*/g;
const TLDS = "com|net|org|io|dev|local|internal|corp|lan|co|ai|app|cloud|intranet|home|biz|info|us|uk|de|eu";
const HOST = new RegExp(
  String.raw`(?<![\w@.-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+(?:${TLDS})(?![\w-])|(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])`,
  "gi",
);

const trimTail = (s: string): [string, string] => {
  const m = /[.,;:!?]+$/.exec(s);
  return m ? [s.slice(0, m.index), m[0]] : [s, ""];
};

function hostOf(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/@\s]*@)?([^/:?#\s]+)/i.exec(url);
  return (m?.[1] ?? "").toLowerCase();
}

function isPublic(host: string, publicHosts: readonly string[]): boolean {
  const h = host.toLowerCase();
  return publicHosts.some((p) => {
    const q = p.toLowerCase();
    return h === q || h.endsWith(`.${q}`);
  });
}

/** Whole-token matcher (hyphens count as part of a token), case-insensitive. */
function termRe(terms: readonly string[]): RegExp | undefined {
  const t = [...new Set(terms.map((x) => x.trim()).filter((x) => x.length > 0))].sort((a, b) => b.length - a.length);
  if (t.length === 0) return undefined;
  return new RegExp(String.raw`(?<![\w-])(?:${t.map(escapeRe).join("|")})(?![\w-])`, "gi");
}

/** Ordered rules: email, url, path, host, repo, denylist. Public URLs/hosts are stashed so later rules leave them alone. */
export function scrub(input: string, opts: ScrubOptions = {}): ScrubResult {
  const publicHosts = opts.publicHosts ?? DEFAULT_PUBLIC_HOSTS;
  const counts: Partial<Record<ScrubCategory, number>> = {};
  const bump = (c: ScrubCategory): void => {
    counts[c] = (counts[c] ?? 0) + 1;
  };
  const stash: string[] = [];
  const keep = (s: string): string => `\u0000${stash.push(s) - 1}\u0000`;
  let text = input;

  text = text.replace(EMAIL, () => (bump("email"), "<email>"));
  text = text.replace(URL_RE, (m) => {
    const [url, tail] = trimTail(m);
    if (isPublic(hostOf(url), publicHosts)) return keep(url) + tail;
    bump("url");
    return `<url>${tail}`;
  });
  text = text.replace(PATH_RE, (m) => {
    const [, tail] = trimTail(m);
    bump("path");
    return `<path>${tail}`;
  });
  text = text.replace(HOST, (m) => {
    if (isPublic(m, publicHosts)) return keep(m);
    bump("host");
    return "<host>";
  });
  const repo = termRe(opts.repoNames ?? []);
  if (repo) text = text.replace(repo, () => (bump("repo"), "<repo>"));
  const deny = termRe(opts.denylist ?? []);
  if (deny) text = text.replace(deny, () => (bump("denylist"), "<term>"));

  text = text.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => stash[Number(i)] ?? "");
  return { text, counts };
}
