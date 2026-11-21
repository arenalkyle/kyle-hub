import type { RetroConfig } from "./types";

export const DEFAULT_RETRO_CONFIG: Readonly<RetroConfig> = {
  minOccurrences: 3,
  minSessions: 2,
  startupCalls: 8,
  ignoreCommands: ["ls", "cd", "pwd", "cat", "git status"],
  outlierMinRuns: 10,
  outlierFactor: 2,
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const posInt = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : fallback);
const posNum = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback);

/** Merges `term.retro.*` settings over the defaults; invalid values fall back per key. */
export function resolveRetroConfig(raw: unknown): RetroConfig {
  const r = isObj(raw) ? raw : {};
  const ignore = Array.isArray(r.ignoreCommands) ? r.ignoreCommands.filter((x): x is string => typeof x === "string") : DEFAULT_RETRO_CONFIG.ignoreCommands;
  return {
    minOccurrences: posInt(r.minOccurrences, DEFAULT_RETRO_CONFIG.minOccurrences),
    minSessions: posInt(r.minSessions, DEFAULT_RETRO_CONFIG.minSessions),
    startupCalls: posInt(r.startupCalls, DEFAULT_RETRO_CONFIG.startupCalls),
    ignoreCommands: [...ignore],
    outlierMinRuns: posInt(r.outlierMinRuns, DEFAULT_RETRO_CONFIG.outlierMinRuns),
    outlierFactor: posNum(r.outlierFactor, DEFAULT_RETRO_CONFIG.outlierFactor),
  };
}
