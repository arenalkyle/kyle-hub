import fs from "node:fs";
import path from "node:path";
import type { DerivedRecord, RunIndexEntry, RunQuery, SpendDay } from "./types";

export const INDEX_FILE = "index.jsonl";

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

/** Summarizes one run's derived records (header first, as written by ingest). Undefined when there is no header. */
export function summarizeRun(runId: string, records: readonly DerivedRecord[]): RunIndexEntry | undefined {
  const header = records.find((r) => r.type === "run");
  if (!header || (header.profile !== "home" && header.profile !== "work")) return undefined;
  let end = header.t;
  let costUsd = 0;
  let toolCalls = 0;
  let errors = 0;
  let denials = 0;
  let model: string | undefined;
  let ticketId = str(header.ticketId);
  let outcome: string | undefined;
  let summaryCommented: boolean | undefined;
  for (const r of records) {
    if (r.t > end) end = r.t;
    switch (r.type) {
      case "usage":
        if (typeof r.costUsd === "number") costUsd += r.costUsd;
        model = str(r.model) ?? model;
        break;
      case "tool_call":
        toolCalls++;
        break;
      case "error":
        errors++;
        break;
      case "permission_denied":
        denials++;
        break;
      case "run_meta":
        ticketId = str(r.ticketId) ?? ticketId;
        outcome = str(r.outcome) ?? outcome;
        if (typeof r.summaryCommented === "boolean") summaryCommented = r.summaryCommented;
        break;
    }
  }
  const durationMs = Math.max(0, Date.parse(end) - Date.parse(header.t)) || 0;
  const entry: RunIndexEntry = {
    runId,
    sessionId: str(header.sessionId) ?? runId.replace(/^s-/, ""),
    profile: header.profile,
    start: header.t,
    end,
    durationMs,
    costUsd: Math.round(costUsd * 1e8) / 1e8,
    toolCalls,
    errors,
    denials,
  };
  if (ticketId) entry.ticketId = ticketId;
  const repo = str(header.repo);
  if (repo) entry.repo = repo;
  if (model) entry.model = model;
  if (outcome) entry.outcome = outcome;
  if (summaryCommented !== undefined) entry.summaryCommented = summaryCommented;
  return entry;
}

/** Replaces entries by runId and appends new ones; result is sorted by start (oldest first). */
export function mergeIndex(existing: readonly RunIndexEntry[], updates: readonly RunIndexEntry[]): RunIndexEntry[] {
  const byId = new Map(existing.map((e) => [e.runId, e] as const));
  for (const u of updates) byId.set(u.runId, u);
  return [...byId.values()].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

export function parseIndex(text: string): RunIndexEntry[] {
  const out: RunIndexEntry[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const o: unknown = JSON.parse(line);
      if (typeof o === "object" && o !== null && typeof (o as RunIndexEntry).runId === "string") out.push(o as RunIndexEntry);
    } catch {
      // a torn or foreign line is ignored; the next ingest rewrites the file
    }
  }
  return out;
}

export function readIndex(dir: string): RunIndexEntry[] {
  try {
    return parseIndex(fs.readFileSync(path.join(dir, INDEX_FILE), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

/** Writes the whole index to a temp file and renames it over the old one, so readers never see a partial file. */
export function writeIndexAtomic(dir: string, entries: readonly RunIndexEntry[]): void {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, INDEX_FILE);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length > 0 ? "\n" : ""));
  fs.renameSync(tmp, file);
}

export function queryRuns(entries: readonly RunIndexEntry[], q: RunQuery = {}): RunIndexEntry[] {
  const since = q.since !== undefined ? Date.parse(q.since) : undefined;
  const out = entries
    .filter((e) => since === undefined || Date.parse(e.start) >= since)
    .filter((e) => q.ticketId === undefined || e.ticketId === q.ticketId)
    .filter((e) => q.repo === undefined || e.repo === q.repo)
    .filter((e) => q.profile === undefined || e.profile === q.profile)
    .sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
  return q.limit !== undefined ? out.slice(0, Math.max(0, q.limit)) : out;
}

export function countSince(entries: readonly RunIndexEntry[], ts: string): number {
  const from = Date.parse(ts);
  return entries.filter((e) => Date.parse(e.start) >= from).length;
}

/** Local calendar day key, `YYYY-MM-DD`. */
export function dayKey(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Cost per local day for the last `days` days ending today, oldest first, zero-filled. */
export function spendByDay(entries: readonly RunIndexEntry[], days: number, now: Date): SpendDay[] {
  const totals = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    totals.set(dayKey(d), 0);
  }
  for (const e of entries) {
    const k = dayKey(new Date(e.start));
    if (totals.has(k)) totals.set(k, (totals.get(k) ?? 0) + e.costUsd);
  }
  return [...totals].map(([day, costUsd]) => ({ day, costUsd: Math.round(costUsd * 1e8) / 1e8 }));
}
