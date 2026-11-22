import type { GapsReport } from "../../../../core/domain/gaps";
import { DEFAULT_GRADING, type GradingConfig } from "../../../../core/domain/grading";
import type { Issue, StatusDef } from "../../../../core/domain/types";
import { categoryOf } from "../../../../core/domain/fields";
import { parseSignature } from "../ticketMeta";

/**
 * Gap proposal thresholds. Note and folder limits come from the vault's grading config (LOCK-68): split_note uses
 * `oversizedWords` and `unkeptDays`, review_note uses the `B` grade cutoff, and split_folder takes LOCK-68's large folders as they are.
 */
export const GAP_THRESHOLDS = {
  emptyMinCount: 3,
  staleDays: 90,
  /** Proposals per Retro run. */
  cap: 5,
} as const;

export const GAP_SIGNATURE_PREFIX = "gap:";

export type GapKind = "split_note" | "write_note" | "review_note" | "split_folder";

/** Order in which kinds are proposed when the cap cuts the list. */
const KIND_ORDER: readonly GapKind[] = ["split_note", "write_note", "review_note", "split_folder"];

export interface GapProposal {
  kind: GapKind;
  /** `gap:<kind>:<target>`; the ticket's `Signature:` line. */
  signature: string;
  title: string;
  body: string;
  /** Higher is worse. Recorded on the ticket as `Badness:` and compared on re-proposal. */
  badness: number;
}

/** Memory of a gap ticket: open ones always suppress; closed ones suppress until the gap is strictly worse than `badness`. */
export type GapMemory = { open: true } | { open: false; badness: number };

const fmt = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function proposal(kind: GapKind, target: string, title: string, reasons: string, badness: number): GapProposal {
  const signature = `${GAP_SIGNATURE_PREFIX}${kind}:${target}`;
  return {
    kind,
    signature,
    title,
    body: `${reasons}\n\nSource: \`.kyle-hub/gaps/latest.json\`.\n\nSignature: \`${signature}\`\nBadness: ${fmt(badness)}`,
    badness,
  };
}

/** Pure: candidate proposals from a gaps report, before memory and cap. Each kind keeps the report's worst-first order. */
export function gapCandidates(report: GapsReport, cfg: GradingConfig = DEFAULT_GRADING): GapProposal[] {
  const t = GAP_THRESHOLDS;
  const out: GapProposal[] = [];
  for (const g of report.grades) {
    if (g.words > cfg.oversizedWords && g.ageDays >= cfg.unkeptDays) {
      out.push(proposal("split_note", g.path, `Split \`${g.path}\` (${fmt(g.words)} words, ${g.grade} ${Math.round(g.score)})`, g.reasons, g.words));
    }
    if (g.score < cfg.thresholds.B || g.ageDays >= t.staleDays) {
      out.push(proposal("review_note", g.path, `Review \`${g.path}\` (${g.grade} ${Math.round(g.score)}, ${Math.round(g.ageDays)} days)`, g.reasons, 100 - g.score));
    }
  }
  for (const e of report.emptySearches) {
    if (e.count < t.emptyMinCount) continue;
    const target = e.pattern ?? e.root;
    const minutes = Math.round(e.totalMs / 60_000);
    out.push(proposal("write_note", target, `Write a note for \`${target}\` (empty ${e.count}×, ${minutes} min agent time)`, `Searches under \`${e.root}\` found nothing ${e.count} times.`, e.count));
  }
  for (const f of report.largeFolders) {
    out.push(proposal("split_folder", f.folder, `Split folder \`${f.folder}\` (${f.notes} notes, avg ${fmt(f.avgWords)} words)`, `${f.notes} notes average ${fmt(f.avgWords)} words.`, f.avgWords));
  }
  return out;
}

/**
 * Pure and deterministic: proposals for the worst gaps, minus those already waiting or not strictly worse than a closed
 * ticket's recorded badness. Sorted by kind, then worst first; capped at `GAP_THRESHOLDS.cap`.
 */
export function detectGapProposals(report: GapsReport | undefined, memory: ReadonlyMap<string, GapMemory>, cfg: GradingConfig = DEFAULT_GRADING, cap: number = GAP_THRESHOLDS.cap): GapProposal[] {
  if (report === undefined) return [];
  const kept = gapCandidates(report, cfg).filter((p) => {
    const m = memory.get(p.signature);
    if (m === undefined) return true;
    return !m.open && p.badness > m.badness;
  });
  const rank = (k: GapKind): number => KIND_ORDER.indexOf(k);
  kept.sort((a, b) => rank(a.kind) - rank(b.kind) || b.badness - a.badness || (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0));
  // Duplicate signatures in one report (should not happen) collapse to the first.
  const seen = new Set<string>();
  return kept.filter((p) => (seen.has(p.signature) ? false : (seen.add(p.signature), true))).slice(0, cap);
}

const BADNESS_LINE = /^Badness: (\d+(?:\.\d+)?)\s*$/m;

/**
 * Memory from existing gap tickets. Open (not completed or canceled) suppress; closed ones carry the `Badness:` they were
 * proposed with. A closed ticket without a readable badness suppresses for good.
 */
export function gapMemory(issues: readonly Issue[], statuses: readonly StatusDef[]): Map<string, GapMemory> {
  const out = new Map<string, GapMemory>();
  for (const issue of issues) {
    const sig = parseSignature(issue.description);
    if (sig === undefined || !sig.startsWith(GAP_SIGNATURE_PREFIX)) continue;
    const cat = categoryOf(issue.status, statuses);
    const closed = cat === "completed" || cat === "canceled";
    const prev = out.get(sig);
    if (!closed) {
      out.set(sig, { open: true });
      continue;
    }
    if (prev?.open) continue;
    const badness = Number(BADNESS_LINE.exec(issue.description)?.[1] ?? Number.POSITIVE_INFINITY);
    out.set(sig, { open: false, badness: prev && !prev.open ? Math.max(prev.badness, badness) : badness });
  }
  return out;
}

/** Open gap proposals waiting for a decision (triage). */
export function countWaitingGapProposals(issues: readonly Issue[], statuses: readonly StatusDef[]): number {
  return issues.filter((i) => {
    const sig = parseSignature(i.description);
    return sig !== undefined && sig.startsWith(GAP_SIGNATURE_PREFIX) && categoryOf(i.status, statuses) === "triage";
  }).length;
}
