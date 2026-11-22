/**
 * Vault gaps report (LOCK-68). Pure: the gatherer (`core/gaps`) supplies facts, this computes grades and gaps.
 * `GapsReport` is the schema of `<vault>/.kyle-hub/gaps/latest.json`, read by Retro detectors, the Brain tab and the terminal sidebar.
 */
import { DEFAULT_GRADING, gradeNote, type Grade, type GradingConfig } from "./grading";

export const GAPS_VERSION = 1;

export interface GradedNote {
  /** Vault-relative, forward slashes. */
  path: string;
  grade: Grade;
  score: number;
  /** Human-readable, e.g. `F 42: 1,900 words, not reviewed for 140 days, re-read 9×`. */
  reasons: string;
  words: number;
  ageDays: number;
  maxReadsInSession: number;
  undoneEdits: number;
  emptySearchesNearby: number;
}

export interface EmptySearchGap {
  /** Vault-relative search root (`.` for the vault root). */
  root: string;
  /** Redacted pattern; absent when the call had none. */
  pattern?: string;
  count: number;
  /** Total agent time spent in these searches. */
  totalMs: number;
}

export interface MissingNote {
  /** Link target with no note behind it. */
  target: string;
  /** Notes (vault-relative) that link to it, capped at 10. */
  linkedFrom: string[];
  /** Agent reads of notes that link to it. */
  reads: number;
  /** Empty searches whose pattern mentions it. */
  emptySearches: number;
}

export interface SearchTime {
  /** Time in vault Grep/Glob calls. */
  searchMs: number;
  /** Time in vault Read calls. */
  readMs: number;
  /** `searchMs + readMs`: time spent looking things up. */
  lookupMs: number;
  /** Duration of the vault sessions' runs. */
  agentMs: number;
  /** `lookupMs / agentMs`, 0 when no agent time. */
  share: number;
}

export interface LargeFolder {
  folder: string;
  notes: number;
  avgWords: number;
}

export interface GapsReport {
  version: typeof GAPS_VERSION;
  /** ISO timestamp. */
  generatedAt: string;
  windowDays: number;
  /** Set when `grading.json` was invalid and defaults were used. */
  warning?: string;
  /** Worst first. */
  grades: GradedNote[];
  summary: { notes: number; byGrade: Record<Grade, number> };
  /** Most agent time first. */
  emptySearches: EmptySearchGap[];
  /** Most hit first. */
  missingNotes: MissingNote[];
  searchTime: SearchTime;
  /** Largest average first. */
  largeFolders: LargeFolder[];
}

export interface NoteFact {
  path: string;
  words: number;
  /** Last edit, epoch ms. */
  mtimeMs: number;
  /** `reviewed` frontmatter date, epoch ms. */
  reviewedMs?: number;
  /** Raw wikilink targets in the body. */
  links: string[];
}

export interface ReadFact {
  path: string;
  sessionId: string;
}
export interface WriteFact {
  path: string;
  sessionId: string;
  t: string;
  before?: string;
  after?: string;
}
export interface SearchFact {
  root: string;
  pattern?: string;
  /** Undefined when unknown (never counted as empty). */
  hits?: number;
  durationMs?: number;
}

export interface GapsInput {
  now: Date;
  notes: NoteFact[];
  reads: ReadFact[];
  writes: WriteFact[];
  searches: SearchFact[];
  /** Duration of the vault sessions' runs. */
  agentMs: number;
  /** Total time of timed vault Read calls. */
  readMs?: number;
  config?: GradingConfig;
  warning?: string;
}

const DAY = 86_400_000;
export const folderOf = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".");
const baseName = (p: string): string => p.slice(p.lastIndexOf("/") + 1).replace(/\.md$/i, "");

/** Edits later undone, per path: a write (same session) whose result matches an earlier write's `before`, or a non-adjacent earlier write's `after`. Session-local. */
export function undoneEditsByPath(writes: readonly WriteFact[]): Map<string, number> {
  const out = new Map<string, number>();
  const bySession = new Map<string, WriteFact[]>();
  for (const w of [...writes].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0))) {
    const k = `${w.sessionId}\n${w.path}`;
    const list = bySession.get(k);
    if (list) list.push(w);
    else bySession.set(k, [w]);
  }
  for (const list of bySession.values()) {
    for (let i = 1; i < list.length; i++) {
      const w = list[i]!;
      if (!w.after) continue;
      const restores = list.slice(0, i).some((e, j) => e.before === w.after || (j < i - 1 && e.after === w.after));
      if (restores) out.set(w.path, (out.get(w.path) ?? 0) + 1);
    }
  }
  return out;
}

/** Link target as a note name: alias, heading and path prefix dropped. */
export function linkName(raw: string): string {
  const t = raw.split("|")[0]!.split("#")[0]!.trim();
  return t.slice(t.lastIndexOf("/") + 1).replace(/\.md$/i, "");
}

export function computeGaps(input: GapsInput): GapsReport {
  const cfg = input.config ?? DEFAULT_GRADING;
  const nowMs = input.now.getTime();
  const noteSet = new Set(input.notes.map((n) => n.path));

  const readCounts = new Map<string, Map<string, number>>();
  for (const r of input.reads) {
    if (!noteSet.has(r.path)) continue;
    const m = readCounts.get(r.path) ?? new Map<string, number>();
    m.set(r.sessionId, (m.get(r.sessionId) ?? 0) + 1);
    readCounts.set(r.path, m);
  }
  const maxReads = (p: string): number => Math.max(0, ...(readCounts.get(p)?.values() ?? []));
  const totalReads = (p: string): number => [...(readCounts.get(p)?.values() ?? [])].reduce((a, b) => a + b, 0);
  const undone = undoneEditsByPath(input.writes.filter((w) => noteSet.has(w.path)));

  const empties = input.searches.filter((s) => s.hits === 0);
  const emptyByFolder = new Map<string, number>();
  for (const s of empties) emptyByFolder.set(s.root, (emptyByFolder.get(s.root) ?? 0) + 1);

  const grades: GradedNote[] = input.notes.map((n) => {
    const lastMs = Math.max(n.mtimeMs, n.reviewedMs ?? 0);
    const ageDays = Math.max(0, Math.floor((nowMs - lastMs) / DAY));
    const facts = { words: n.words, ageDays, maxReadsInSession: maxReads(n.path), undoneEdits: undone.get(n.path) ?? 0, emptySearchesNearby: emptyByFolder.get(folderOf(n.path)) ?? 0 };
    const g = gradeNote(facts, cfg);
    return { path: n.path, grade: g.grade, score: g.score, reasons: g.reasons, ...facts };
  });
  grades.sort((a, b) => a.score - b.score || (a.path < b.path ? -1 : 1));
  const byGrade: Record<Grade, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const g of grades) byGrade[g.grade]++;

  const emptyMap = new Map<string, EmptySearchGap>();
  for (const s of empties) {
    const k = `${s.root}\n${s.pattern ?? ""}`;
    const e = emptyMap.get(k) ?? { root: s.root, ...(s.pattern !== undefined ? { pattern: s.pattern } : {}), count: 0, totalMs: 0 };
    e.count++;
    e.totalMs += s.durationMs ?? 0;
    emptyMap.set(k, e);
  }
  const emptySearches = [...emptyMap.values()].sort((a, b) => b.totalMs - a.totalMs || b.count - a.count);

  // Missing notes: link targets with no note of that name, scored by agent reads of linking notes and empty searches naming them.
  const names = new Set(input.notes.map((n) => baseName(n.path).toLowerCase()));
  const missing = new Map<string, MissingNote>();
  for (const n of input.notes) {
    for (const raw of n.links) {
      const name = linkName(raw);
      if (!name || names.has(name.toLowerCase())) continue;
      const key = name.toLowerCase();
      const m = missing.get(key) ?? { target: name, linkedFrom: [], reads: 0, emptySearches: 0 };
      if (!m.linkedFrom.includes(n.path)) {
        m.linkedFrom.push(n.path);
        m.reads += totalReads(n.path);
      }
      missing.set(key, m);
    }
  }
  const patterns = empties.map((s) => (s.pattern ?? "").toLowerCase());
  const missingNotes = [...missing.values()]
    .map((m) => ({ ...m, linkedFrom: m.linkedFrom.sort().slice(0, 10), emptySearches: patterns.filter((p) => p.includes(m.target.toLowerCase())).length }))
    .filter((m) => m.reads + m.emptySearches > 0)
    .sort((a, b) => b.reads + b.emptySearches - (a.reads + a.emptySearches));

  const searchMs = input.searches.reduce((a, s) => a + (s.durationMs ?? 0), 0);
  const readMs = input.readMs ?? 0;
  const lookupMs = searchMs + readMs;
  const searchTime: SearchTime = { searchMs, readMs, lookupMs, agentMs: input.agentMs, share: input.agentMs > 0 ? Math.min(1, lookupMs / input.agentMs) : 0 };

  const folders = new Map<string, { notes: number; words: number }>();
  for (const n of input.notes) {
    const f = folderOf(n.path);
    const e = folders.get(f) ?? { notes: 0, words: 0 };
    e.notes++;
    e.words += n.words;
    folders.set(f, e);
  }
  const largeFolders: LargeFolder[] = [...folders.entries()]
    .map(([folder, e]) => ({ folder, notes: e.notes, avgWords: Math.round(e.words / e.notes) }))
    .filter((f) => f.notes >= cfg.largeFolderMinNotes && f.avgWords > cfg.largeFolderWords)
    .sort((a, b) => b.avgWords - a.avgWords);

  return {
    version: GAPS_VERSION,
    generatedAt: input.now.toISOString(),
    windowDays: cfg.windowDays,
    ...(input.warning ? { warning: input.warning } : {}),
    grades,
    summary: { notes: grades.length, byGrade },
    emptySearches,
    missingNotes,
    searchTime,
    largeFolders,
  };
}
