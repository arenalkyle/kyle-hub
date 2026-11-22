import { createHash } from "node:crypto";

/** Vault access derived from a Claude Code hook payload. Pure; never carries file contents. */
export type AccessKind = "read" | "write" | "search";

export interface VaultAccess {
  kind: AccessKind;
  /** Vault-relative, forward slashes (read / write). */
  path?: string;
  pattern?: string;
  /** Vault-relative search root (`.` for the vault root). */
  root?: string;
  hits?: number;
  /** Short content hashes of a write (never contents): `before` = replaced text (Edit), `after` = new text. Lets Gaps spot undone edits. */
  before?: string;
  after?: string;
}

const shortHash = (text: string): string => createHash("sha1").update(text).digest("hex").slice(0, 12);

const KINDS: Record<string, AccessKind> = { Read: "read", Write: "write", Edit: "write", MultiEdit: "write", NotebookEdit: "write", Grep: "search", Glob: "search" };

const norm = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "");
const isAbs = (p: string): boolean => /^[a-zA-Z]:\//.test(p) || p.startsWith("/");

/** Collapses `.` and `..` segments of a forward-slash path. */
function collapse(p: string): string {
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/** Vault-relative form of `p` (absolute, or relative to `cwd`); undefined when outside the vault. */
export function toVaultRelative(vaultRoot: string, p: string, cwd?: string): string | undefined {
  const root = collapse(norm(vaultRoot));
  let abs = norm(p);
  if (!isAbs(abs)) {
    if (!cwd) return undefined;
    abs = `${norm(cwd)}/${abs}`;
  }
  abs = collapse(abs);
  const lr = root.toLowerCase();
  const la = abs.toLowerCase();
  if (la === lr) return ".";
  if (!la.startsWith(`${lr}/`)) return undefined;
  return abs.slice(root.length + 1);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

/** Vault-relative search root of a Grep/Glob call (`path` arg, else the session cwd); undefined when outside the vault. */
export function searchRoot(vaultRoot: string, rootArg: string | undefined, cwd: string | undefined): string | undefined {
  return rootArg ? toVaultRelative(vaultRoot, rootArg, cwd) : cwd ? toVaultRelative(vaultRoot, cwd) : undefined;
}

/** Number of hits in a Grep/Glob `tool_response`: `numFiles`, a file list, or lines of a short string. */
export function countHits(response: unknown): number | undefined {
  if (Array.isArray(response)) return response.length;
  if (typeof response === "string") {
    const text = response.trim();
    if (/^No (files|matches) found/i.test(text)) return 0;
    const header = /^Found (\d+) /.exec(text);
    if (header) return Number(header[1]);
    // The hook caps strings at 500 chars; a capped string cannot be counted.
    if (response.length >= 500) return undefined;
    return response.split(/\r?\n/).filter((l) => l.trim() !== "").length;
  }
  if (!isObj(response)) return undefined;
  if (typeof response.numFiles === "number") return response.numFiles;
  if (Array.isArray(response.filenames)) return response.filenames.length;
  if (typeof response.numMatches === "number") return response.numMatches;
  if (typeof response.content === "string" && response.content.length < 500) return countHits(response.content);
  return undefined;
}

/**
 * The vault access one PostToolUse payload represents, or null (other tool, other event, or outside the vault).
 * Only the path, pattern, search root and hit count are kept.
 */
export function accessFromHook(event: string, payload: Record<string, unknown>, vaultRoot: string): VaultAccess | null {
  if (event !== "PostToolUse") return null;
  const tool = str(payload.tool_name);
  const kind = tool ? KINDS[tool] : undefined;
  if (!tool || !kind) return null;
  const input = isObj(payload.tool_input) ? payload.tool_input : {};
  const cwd = str(payload.cwd);
  if (kind === "search") {
    const rootArg = str(input.path);
    const root = searchRoot(vaultRoot, rootArg, cwd);
    if (root === undefined) return null;
    const pattern = str(input.pattern);
    const hits = countHits(payload.tool_response);
    return { kind, root, ...(pattern ? { pattern } : {}), ...(hits !== undefined ? { hits } : {}) };
  }
  const file = str(input.file_path) ?? str(input.notebook_path);
  if (!file) return null;
  const rel = toVaultRelative(vaultRoot, file, cwd);
  if (rel === undefined) return null;
  const before = typeof input.old_string === "string" ? shortHash(input.old_string) : undefined;
  const newText = typeof input.new_string === "string" ? input.new_string : typeof input.content === "string" ? input.content : undefined;
  const after = kind === "write" && newText !== undefined ? shortHash(newText) : undefined;
  return { kind, path: rel, ...(before ? { before } : {}), ...(after ? { after } : {}) };
}
