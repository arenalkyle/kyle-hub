import type { DerivedRecord, RunIndexEntry } from "../../../../core/logs/types";
import type { RetroConfig, Signal, SignalKind } from "../types";

export type PerRunDetector = (run: RunIndexEntry, records: readonly DerivedRecord[], cfg: RetroConfig) => Signal[];

export function signalOf(run: RunIndexEntry, kind: SignalKind, signature: string, t: string): Signal {
  return { kind, signature, runId: run.runId, sessionId: run.sessionId, repo: run.repo, t };
}

export const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
