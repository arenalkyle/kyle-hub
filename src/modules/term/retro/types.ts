import type { DerivedRecord, RunIndexEntry, RunQuery } from "../../../core/logs/types";

/** Read-only view of the logs; `LogService` satisfies it structurally. */
export interface LogReader {
  runs(q?: RunQuery): Promise<RunIndexEntry[]>;
  records(runId: string): AsyncIterable<DerivedRecord>;
}

export type SignalKind = "repeated_error" | "permission_denied" | "command_sequence" | "user_correction" | "startup_docs" | "outlier";

export interface Signal {
  kind: SignalKind;
  signature: string;
  runId: string;
  sessionId: string;
  repo?: string;
  t: string;
}

export interface Cluster {
  signature: string;
  kind: SignalKind;
  count: number;
  sessions: string[];
  runIds: string[];
  firstSeen: string;
  lastSeen: string;
  repo?: string;
}

export interface RetroConfig {
  minOccurrences: number;
  minSessions: number;
  /** Files read within the first N tool calls of a run count as startup docs. */
  startupCalls: number;
  /** Trivial commands dropped before windowing. Matched against each `;` segment of `cmdNorm`. */
  ignoreCommands: string[];
  outlierMinRuns: number;
  outlierFactor: number;
}

export interface DetectInput {
  runs: readonly RunIndexEntry[];
  /** Records per runId, in file order. Runs without an entry contribute no record-based signals. */
  records: ReadonlyMap<string, readonly DerivedRecord[]>;
  config: RetroConfig;
  /** Only runs with `start` strictly after this ISO time are considered. */
  watermark?: string;
  /** ticketId -> ticket `type`; needed for outliers. Runs without a known type are skipped. */
  ticketTypes?: ReadonlyMap<string, string>;
}

export interface DetectResult {
  signals: Signal[];
  clusters: Cluster[];
}
