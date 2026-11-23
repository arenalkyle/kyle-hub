/** Pure note grading (LOCK-68): 0-100 from age, re-reads, undone agent edits, oversized-and-unkept and nearby empty searches. */
export type Grade = "A" | "B" | "C" | "D" | "F";

export interface GradingConfig {
  /** Minimum score for each grade; anything below `D` is F. */
  thresholds: { A: number; B: number; C: number; D: number };
  /** Days without edit or review before age starts to cost points. */
  ageGraceDays: number;
  /** Words above which an unkept note is oversized. */
  oversizedWords: number;
  /** Days without edit or review that make a note unkept. */
  unkeptDays: number;
  /** Reads of one note in one session that count as re-reading. */
  rereadMin: number;
  /** Folders with at least this many notes and an average above `largeFolderWords` are split candidates. */
  largeFolderMinNotes: number;
  largeFolderWords: number;
  /** Look-back for agent activity (reads, edits, searches). */
  windowDays: number;
  /** Vault-relative globs for code the markers miss; skipped by Gaps and vault brain lint. */
  exclude: string[];
  weights: {
    /** Points lost per day beyond the grace period, capped at `ageCap`. */
    agePerDay: number;
    ageCap: number;
    /** Points per re-read beyond the second in a session (worst session), capped. */
    rereadEach: number;
    rereadCap: number;
    undoneEach: number;
    undoneCap: number;
    /** Flat cost of oversized-and-unkept plus `oversizedPer100` per 100 words over the limit, capped. */
    oversizedBase: number;
    oversizedPer100: number;
    oversizedCap: number;
    emptySearchEach: number;
    emptySearchCap: number;
  };
}

export const DEFAULT_GRADING: GradingConfig = {
  thresholds: { A: 90, B: 80, C: 70, D: 60 },
  ageGraceDays: 30,
  oversizedWords: 500,
  unkeptDays: 30,
  rereadMin: 3,
  largeFolderMinNotes: 3,
  largeFolderWords: 400,
  windowDays: 30,
  exclude: [],
  weights: {
    agePerDay: 0.1, ageCap: 30,
    rereadEach: 3, rereadCap: 30,
    undoneEach: 8, undoneCap: 24,
    oversizedBase: 15, oversizedPer100: 1, oversizedCap: 30,
    emptySearchEach: 2, emptySearchCap: 10,
  },
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `defaults` overlaid with the finite numbers of `over`, key by key (recursive); unknown keys and non-numbers are ignored. */
function overlay<T extends object>(defaults: T, over: unknown): T {
  if (!isObj(over)) return defaults;
  const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  for (const [k, d] of Object.entries(defaults)) {
    const v = over[k];
    if (typeof d === "number") out[k] = typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d;
    else if (isObj(d)) out[k] = overlay(d, v);
  }
  return out as T;
}

/** Parses `grading.json`: any key overrides its default; invalid JSON or a non-object falls back to defaults with a warning. */
export function parseGradingConfig(text: string | undefined): { config: GradingConfig; warning?: string } {
  if (text === undefined) return { config: DEFAULT_GRADING };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { config: DEFAULT_GRADING, warning: `grading.json is not valid JSON (${(e as Error).message}); using defaults` };
  }
  if (!isObj(raw)) return { config: DEFAULT_GRADING, warning: "grading.json must be a JSON object; using defaults" };
  const config = overlay(DEFAULT_GRADING, raw);
  if (raw.exclude === undefined) return { config };
  if (Array.isArray(raw.exclude) && raw.exclude.every((g) => typeof g === "string")) return { config: { ...config, exclude: raw.exclude as string[] } };
  return { config, warning: "grading.json `exclude` must be an array of glob strings; using the default (none)" };
}

export interface NoteGradeInput {
  words: number;
  /** Days since the last edit or `reviewed` date, whichever is later. */
  ageDays: number;
  /** Most reads of this note in a single session within the window. */
  maxReadsInSession: number;
  /** Agent edits later undone within the window. */
  undoneEdits: number;
  /** Empty searches rooted in this note's folder within the window. */
  emptySearchesNearby: number;
}

export interface NoteGrade {
  grade: Grade;
  score: number;
  /** Human-readable, e.g. `F 42: 1,900 words, not reviewed for 140 days, re-read 9×`. */
  reasons: string;
}

export function gradeOf(score: number, t: GradingConfig["thresholds"] = DEFAULT_GRADING.thresholds): Grade {
  return score >= t.A ? "A" : score >= t.B ? "B" : score >= t.C ? "C" : score >= t.D ? "D" : "F";
}

const capped = (value: number, cap: number): number => Math.min(cap, value);

/** Grades one note; pure and deterministic. */
export function gradeNote(i: NoteGradeInput, cfg: GradingConfig = DEFAULT_GRADING): NoteGrade {
  const w = cfg.weights;
  const parts: string[] = [];
  let penalty = 0;
  const ageDays = Math.floor(i.ageDays);
  const unkept = ageDays >= cfg.unkeptDays;
  const oversized = i.words > cfg.oversizedWords && unkept;
  const agePenalty = capped(Math.max(0, ageDays - cfg.ageGraceDays) * w.agePerDay, w.ageCap);
  penalty += agePenalty;
  if (oversized) {
    penalty += capped(w.oversizedBase + Math.floor((i.words - cfg.oversizedWords) / 100) * w.oversizedPer100, w.oversizedCap);
    parts.push(`${i.words.toLocaleString("en-US")} words`);
  }
  if (agePenalty > 0 || oversized) parts.push(`not reviewed for ${ageDays} days`);
  if (i.maxReadsInSession >= cfg.rereadMin) {
    penalty += capped((i.maxReadsInSession - cfg.rereadMin + 1) * w.rereadEach, w.rereadCap);
    parts.push(`re-read ${i.maxReadsInSession}×`);
  }
  if (i.undoneEdits > 0) {
    penalty += capped(i.undoneEdits * w.undoneEach, w.undoneCap);
    parts.push(`${i.undoneEdits} agent edit${i.undoneEdits === 1 ? "" : "s"} undone`);
  }
  if (i.emptySearchesNearby > 0) {
    penalty += capped(i.emptySearchesNearby * w.emptySearchEach, w.emptySearchCap);
    parts.push(`${i.emptySearchesNearby} empty search${i.emptySearchesNearby === 1 ? "" : "es"} nearby`);
  }
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  const grade = gradeOf(score, cfg.thresholds);
  return { grade, score, reasons: `${grade} ${score}: ${parts.length ? parts.join(", ") : "no issues"}` };
}
