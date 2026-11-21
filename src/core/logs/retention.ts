import fs from "node:fs";
import path from "node:path";
import { readIndex, writeIndexAtomic, INDEX_FILE } from "./runIndex";

const DAY_MS = 86_400_000;

export interface RetentionPolicy {
  /** Derived run records and their index lines. */
  retentionDays: number;
  /** Context packs (`packs/*`). */
  packRetentionDays: number;
  /** Consumed hook spool files (`hooks/*.jsonl`). */
  spoolDays: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = { retentionDays: 365, packRetentionDays: 30, spoolDays: 7 };

export interface SweepItem {
  kind: "run" | "index" | "pack" | "spool";
  path: string;
  detail?: string;
}

export interface SweepResult {
  dryRun: boolean;
  items: SweepItem[];
}

const listDir = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);

/**
 * Finds (and, unless `dryRun`, removes) what is past retention in one profile dir.
 * `hookOffsets` maps spool file name to bytes already ingested; a spool file is only removed once fully ingested.
 */
export function sweepProfile(dir: string, now: Date, policy: RetentionPolicy, dryRun: boolean, hookOffsets: Readonly<Record<string, number>>): SweepResult {
  const items: SweepItem[] = [];
  const cutoffRuns = now.getTime() - policy.retentionDays * DAY_MS;
  const olderThan = (p: string, cutoff: number): boolean => fs.statSync(p).mtimeMs < cutoff;

  for (const name of listDir(path.join(dir, "runs"))) {
    const p = path.join(dir, "runs", name);
    if (name.endsWith(".jsonl") && olderThan(p, cutoffRuns)) items.push({ kind: "run", path: p });
  }

  const index = readIndex(dir);
  const keep = index.filter((e) => Date.parse(e.start) >= cutoffRuns);
  const dropped = index.length - keep.length;
  if (dropped > 0) {
    items.push({ kind: "index", path: path.join(dir, INDEX_FILE), detail: `${dropped} line(s)` });
    if (!dryRun) writeIndexAtomic(dir, keep);
  }

  for (const name of listDir(path.join(dir, "packs"))) {
    const p = path.join(dir, "packs", name);
    if (olderThan(p, now.getTime() - policy.packRetentionDays * DAY_MS)) items.push({ kind: "pack", path: p });
  }

  const spoolCutoff = now.getTime() - policy.spoolDays * DAY_MS;
  for (const name of listDir(path.join(dir, "hooks"))) {
    if (!name.endsWith(".jsonl")) continue;
    const p = path.join(dir, "hooks", name);
    if (!olderThan(p, spoolCutoff)) continue;
    if ((hookOffsets[name] ?? 0) < fs.statSync(p).size) continue;
    items.push({ kind: "spool", path: p });
  }

  if (!dryRun) {
    for (const it of items) if (it.kind !== "index") fs.rmSync(it.path, { recursive: true, force: true });
  }
  return { dryRun, items };
}
