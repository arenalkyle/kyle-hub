import path from "node:path";

interface Tok {
  text: string;
  quoted: boolean;
}

const MAX_CMD = 200;
const MAX_SIG = 160;
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** Splits a shell line on unquoted `|`, `;`, `&`. */
export function splitSegments(cmd: string): string[] {
  const segs: string[] = [];
  let cur = "";
  let q: string | null = null;
  for (const ch of cmd) {
    if (q) {
      cur += ch;
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
      continue;
    }
    if (ch === "|" || ch === ";" || ch === "&") {
      segs.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  segs.push(cur);
  return segs.map((s) => s.trim()).filter((s) => s.length > 0);
}

function tokenize(seg: string): Tok[] {
  const out: Tok[] = [];
  let cur = "";
  let q: string | null = null;
  let had = false;
  let quoted = false;
  for (const ch of seg) {
    if (q) {
      if (ch === q) q = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      had = true;
      quoted = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (had) out.push({ text: cur, quoted });
      cur = "";
      had = false;
      quoted = false;
      continue;
    }
    cur += ch;
    had = true;
  }
  if (had) out.push({ text: cur, quoted });
  return out;
}

const isPathish = (t: string): boolean => /[\\/]/.test(t) || /^[.~]/.test(t) || /^[A-Za-z]:/.test(t) || /\.[A-Za-z0-9]{1,6}$/.test(t);

function normalizeSegment(seg: string): string {
  const [head, ...rest] = tokenize(seg);
  if (!head) return "";
  const bin = (head.text.split(/[\\/]/).pop() ?? head.text).toLowerCase().replace(/\.exe$/, "");
  const parts: string[] = [bin];
  rest.forEach((t, i) => {
    if (!t.quoted && t.text.startsWith("-")) return;
    if (t.quoted) parts.push("<str>");
    else if (/^-?\d+(\.\d+)?$/.test(t.text)) parts.push("<num>");
    else if (isPathish(t.text)) parts.push("<path>");
    else parts.push(i === 0 && /^[A-Za-z][\w:-]*$/.test(t.text) ? t.text.toLowerCase() : t.text);
  });
  return parts.join(" ");
}

/** Normalized command: lowercased binary and subcommand, args masked, flags dropped. */
export function normalizeCommand(cmd: string): string {
  return splitSegments(cmd).map(normalizeSegment).filter((s) => s.length > 0).join(" ; ").slice(0, MAX_CMD);
}

/** First line of an error, with paths and numbers masked. */
export function normalizeSig(text: string): string {
  const first = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return first
    .replace(/(?:[A-Za-z]:)?[\\/][^\s"'`:]+/g, "<path>")
    .replace(/\b\d+\b/g, "<num>")
    .replace(/\s+/g, " ")
    .slice(0, MAX_SIG);
}

/** Repo-relative, forward-slash path; files outside the repo become `<external>/<basename>`. */
export function pathRel(file: string, cwd: string | undefined): string | undefined {
  if (!file) return undefined;
  if (!cwd) return file.replace(/\\/g, "/");
  const rel = path.relative(cwd, file);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return `<external>/${path.basename(file)}`;
  return rel.replace(/\\/g, "/");
}

export const isShellTool = (tool: string): boolean => SHELL_TOOLS.has(tool);
export const isWriteTool = (tool: string): boolean => WRITE_TOOLS.has(tool);
