import fs from "node:fs";
import path from "node:path";
import type { RunIndexEntry } from "../../../core/logs/types";
import type { DetectResult } from "./types";

export const RETRO_FILE = "retro.json";

export const retroFile = (dataRoot: string): string => path.join(dataRoot, RETRO_FILE);

export interface RetroHistoryEntry {
  at: string;
  clusters: string[];
  ticketIds: string[];
}

/** `%LOCALAPPDATA%\kyle-hub\<profile>\retro.json`. */
export interface RetroState {
  watermark?: string;
  lastRetroAt?: string;
  history: RetroHistoryEntry[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Missing or unreadable state reads as "no retro yet". */
export function readRetroState(file: string): RetroState {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { history: [] };
  }
  if (!isObj(raw)) return { history: [] };
  const history = Array.isArray(raw.history)
    ? raw.history.filter(isObj).map((h) => ({ at: typeof h.at === "string" ? h.at : "", clusters: strList(h.clusters), ticketIds: strList(h.ticketIds) }))
    : [];
  return {
    ...(typeof raw.watermark === "string" ? { watermark: raw.watermark } : {}),
    ...(typeof raw.lastRetroAt === "string" ? { lastRetroAt: raw.lastRetroAt } : {}),
    history,
  };
}

export function writeRetroStateAtomic(file: string, state: RetroState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

/** Records a retro: advances the watermark to `now`, appends history, persists atomically. Returns the new state. */
export function commitRetro(file: string, result: DetectResult, ticketIds: readonly string[], now: Date = new Date()): RetroState {
  const at = now.toISOString();
  const prev = readRetroState(file);
  const next: RetroState = {
    watermark: at,
    lastRetroAt: at,
    history: [...prev.history, { at, clusters: result.clusters.map((c) => c.signature), ticketIds: [...ticketIds] }],
  };
  writeRetroStateAtomic(file, next);
  return next;
}

/** Index runs started strictly after the watermark. */
export function sessionsSinceRetro(runs: readonly RunIndexEntry[], watermark?: string): number {
  return runs.filter((r) => watermark === undefined || Date.parse(r.start) > Date.parse(watermark)).length;
}
