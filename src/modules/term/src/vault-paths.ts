import nodePath from "node:path";

export type PathMode = "relative" | "absolute";
export type Flavor = "win32" | "posix";

const lib = (f: Flavor) => (f === "win32" ? nodePath.win32 : nodePath.posix);

/**
 * Build an `@path` reference for Claude Code.
 *
 * Spaces: a path containing whitespace is written as `@"path with spaces"`
 * (Claude Code's quoted-mention form); unquoted, the mention would end at the
 * first space. This is the form chosen without being able to run the installed
 * CLI here; it is isolated in this function so it is a one-line change.
 * Relative paths use `/` separators (accepted on Windows too); absolute paths
 * keep the platform's native separators. Anything outside `cwd` (or on another
 * drive) is always absolute.
 */
export function buildRef(absPath: string, cwd: string | undefined, mode: PathMode, flavor: Flavor = process.platform === "win32" ? "win32" : "posix"): string {
  const p = lib(flavor);
  let out = p.normalize(absPath);
  if (out.length > 1) out = out.replace(/[\\/]+$/, "") || out;
  if (mode === "relative" && cwd) {
    const rel = p.relative(p.normalize(cwd), out);
    if (rel !== "" && !rel.startsWith("..") && !p.isAbsolute(rel)) out = rel.split(/[\\/]/).join("/");
  }
  return /\s/.test(out) ? `@"${out}"` : `@${out}`;
}

export function buildRefs(absPaths: string[], cwd: string | undefined, mode: PathMode, flavor?: Flavor): string {
  return absPaths.map((a) => buildRef(a, cwd, mode, flavor)).join(" ");
}

export type DropParse = { kind: "paths"; paths: string[] } | { kind: "text"; text: string };

/**
 * Interpret `text/plain` from a drop. `obsidian://open?vault=..&file=..` and
 * `[[wikilink]]` yield vault-relative paths/link text (resolved by the caller);
 * `obsidian://` URLs for other vaults and everything else stay text.
 */
export function parseDropText(text: string, vaultName: string): DropParse {
  const t = text.trim();
  const urls = t.split(/\r?\n/).filter(Boolean);
  const out: string[] = [];
  for (const line of urls) {
    const l = line.trim();
    const m = /^obsidian:\/\/open\?(.*)$/.exec(l);
    if (m) {
      const q = new URLSearchParams(m[1]);
      const file = q.get("file");
      const v = q.get("vault");
      if (!file || (v && v !== vaultName)) return { kind: "text", text };
      out.push(file);
      continue;
    }
    const w = /^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/.exec(l);
    if (w) { out.push(w[1]!.trim()); continue; }
    return { kind: "text", text };
  }
  return out.length > 0 ? { kind: "paths", paths: out } : { kind: "text", text };
}
