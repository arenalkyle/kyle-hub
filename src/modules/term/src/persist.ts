import type { Session, SessionKind } from "./session-manager";

export const PERSIST_VERSION = 1;
export const DEFAULT_SCROLLBACK_LINES = 2000;

/** Everything needed to bring a session row back after a restart. Every field but id is optional on read. */
export interface PersistedSession {
  id: string;
  kind: SessionKind;
  profileId: string;
  cwd: string;
  command?: string;
  manualTitle?: string;
  oscTitle?: string;
  firstPrompt?: string;
  color?: string;
  claudeSessionId?: string;
  lastOutputAt: number;
  /** When this snapshot was written; shown in the restore divider. */
  savedAt: number;
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function serializeSessions(sessions: readonly Session[], now: number): PersistedSession[] {
  return sessions.map((s) => {
    const p: PersistedSession = {
      id: s.id, kind: s.kind, profileId: s.profileId, cwd: s.cwd, lastOutputAt: s.lastOutputAt, savedAt: now,
    };
    if (s.command) p.command = s.command;
    if (s.manualTitle) p.manualTitle = s.manualTitle;
    if (s.oscTitle) p.oscTitle = s.oscTitle;
    if (s.agent.firstPrompt) p.firstPrompt = s.agent.firstPrompt;
    if (s.color) p.color = s.color;
    if (s.agent.claudeSessionId) p.claudeSessionId = s.agent.claudeSessionId;
    return p;
  });
}

const optStr = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Tolerant reader: unknown shapes give [], bad entries are dropped, missing fields get defaults. */
export function parsePersisted(raw: unknown): PersistedSession[] {
  if (!Array.isArray(raw)) return [];
  const out: PersistedSession[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = optStr(o.id);
    if (!id || !SAFE_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    const lastOutputAt = num(o.lastOutputAt, 0);
    const p: PersistedSession = {
      id,
      kind: o.kind === "claude" ? "claude" : "shell",
      profileId: typeof o.profileId === "string" ? o.profileId : "",
      cwd: typeof o.cwd === "string" ? o.cwd : "",
      lastOutputAt,
      savedAt: num(o.savedAt, lastOutputAt),
    };
    for (const k of ["command", "manualTitle", "oscTitle", "firstPrompt", "color", "claudeSessionId"] as const) {
      const v = optStr(o[k]);
      if (v) p[k] = v;
    }
    out.push(p);
  }
  return out;
}

export const scrollbackFile = (id: string): string => `${id}.txt`;

/** Scrollback files (by name) that belong to no known session. Only `<id>.txt` names are ever returned. */
export function orphanFiles(files: readonly string[], keepIds: Iterable<string>): string[] {
  const keep = new Set([...keepIds].map(scrollbackFile));
  return files.filter((f) => /^[A-Za-z0-9_-]+\.txt$/.test(f) && !keep.has(f));
}

/** Keep the last `n` lines. */
export function trimLines(text: string, n: number): string {
  const lines = text.split("\n");
  return lines.length > n ? lines.slice(lines.length - n).join("\n") : text;
}

/** Strip colours and wrap each line in dim, so restored history reads as greyed out. */
export function dimScrollback(text: string): string {
  // eslint-disable-next-line no-control-regex
  const plain = text.replace(/\x1b\[[0-9;:]*m/g, "").replace(/\s+$/, "");
  if (!plain) return "";
  return plain.split(/\r?\n/).map((l) => `\x1b[2m${l}\x1b[0m`).join("\r\n") + "\r\n";
}

export function dividerLine(at: number): string {
  return `\r\n\x1b[2m— session ended, restored from ${new Date(at).toLocaleString()} —\x1b[0m\r\n\r\n`;
}
