/** Code roots inside a vault (LOCK-74). Pure: callers pass directory listings in; nothing here touches the file system. */

/** Names that make their folder a code root (`.git` may be a folder or a file). */
const MARKER_NAMES = new Set([".git", "package.json", "cargo.toml", "pyproject.toml", "go.mod", "cmakelists.txt"]);
const MARKER_SUFFIXES = [".csproj", ".sln"];

export interface DirListing {
  /** Vault-relative, forward slashes; "" is the vault root. */
  path: string;
  /** Names (files and folders) directly inside. */
  names: readonly string[];
}

export const isCodeMarker = (name: string): boolean => {
  const n = name.toLowerCase();
  return MARKER_NAMES.has(n) || MARKER_SUFFIXES.some((s) => n.endsWith(s));
};

export const hasCodeMarker = (names: readonly string[]): boolean => names.some(isCodeMarker);

const norm = (p: string): string => p.replaceAll("\\", "/").replace(/^(\.\/|\/)+/, "").replace(/\/+$/, "");

/**
 * Code roots among the listed folders, outermost only, sorted. The vault root itself never counts
 * (a vault is often a git repo; its notes are not code).
 */
export function findCodeRoots(listings: readonly DirListing[]): string[] {
  const roots = listings.map((l) => ({ p: norm(l.path), names: l.names })).filter((l) => l.p !== "" && hasCodeMarker(l.names)).map((l) => l.p).sort();
  const out: string[] = [];
  for (const r of roots) {
    if (!out.some((o) => r.toLowerCase().startsWith(`${o.toLowerCase()}/`))) out.push(r);
  }
  return out;
}

/** Glob to regex: `**` crosses folders, `*` and `?` stay within a name. Case-insensitive. */
function globToRegExp(glob: string): RegExp {
  let re = "";
  const g = norm(glob);
  for (let i = 0; i < g.length; i++) {
    const c = g[i]!;
    if (c === "*") {
      if (g[i + 1] === "*") {
        i++;
        if (g[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}

/** Matcher for vault-relative paths covered by any glob, or by a folder a glob names. */
export function createExcludeMatcher(globs: readonly string[]): (relPath: string) => boolean {
  const res = globs.map((g) => norm(g)).filter((g) => g !== "").map(globToRegExp);
  if (res.length === 0) return () => false;
  return (relPath) => {
    const parts = norm(relPath).split("/");
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join("/");
      if (res.some((r) => r.test(prefix))) return true;
    }
    return false;
  };
}

/** Matcher for vault-relative paths under a code root or an `exclude` glob. */
export function createCodeMatcher(roots: readonly string[], exclude: readonly string[] = []): (relPath: string) => boolean {
  const lowered = roots.map((r) => norm(r).toLowerCase()).filter((r) => r !== "");
  const excluded = createExcludeMatcher(exclude);
  return (relPath) => {
    const p = norm(relPath).toLowerCase();
    if (p === "" || p === ".") return false;
    return lowered.some((r) => p === r || p.startsWith(`${r}/`)) || excluded(relPath);
  };
}
