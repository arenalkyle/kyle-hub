export type Profile = "home" | "work";
export const PROFILES: readonly Profile[] = ["home", "work"];

/** Price per million tokens, keyed by model id. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}
export type PriceTable = Readonly<Record<string, ModelPrice>>;

export interface RepoMapEntry {
  path: string;
  profile: Profile;
  name?: string;
}

/** A hook event forwarded by kyle-hook.js (KH_TICKET / KH_RUN are passed through when set). */
export interface HookEvent {
  sessionId: string;
  name: string;
  t?: string;
  state?: string;
  runId?: string;
  ticketId?: string;
  cwd?: string;
  profile?: Profile;
}

export interface IngestOptions {
  /** Restrict to one profile; omitted = all profiles. */
  profile?: Profile;
  /** Restrict transcript ingest to one Claude session (the transcript file's basename). */
  sessionId?: string;
}

export interface RunMeta {
  outcome?: string;
  summaryCommented?: boolean;
}

export interface IngestResult {
  runsUpdated: number;
  records: number;
  /** Transcript/hook lines that were not mapped to a derived record (unknown types, malformed JSON). */
  skipped: number;
}

/** One line of `<profile>/index.jsonl`: a summary of one run, rewritten by ingest. */
export interface RunIndexEntry {
  runId: string;
  sessionId: string;
  ticketId?: string;
  repo?: string;
  profile: Profile;
  model?: string;
  start: string;
  end?: string;
  durationMs: number;
  costUsd: number;
  toolCalls: number;
  errors: number;
  denials: number;
  outcome?: string;
  summaryCommented?: boolean;
}

export interface RunQuery {
  /** ISO timestamp or date; keeps runs starting at or after it. */
  since?: string;
  ticketId?: string;
  repo?: string;
  /** Only runs of this profile (the vault profile for the dashboard and retro). */
  profile?: Profile;
  limit?: number;
}

export interface SpendDay {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string;
  costUsd: number;
}

export interface LogService {
  ingest(opts?: IngestOptions): Promise<IngestResult>;
  appendHookEvent(event: HookEvent): void;
  /** Records `outcome` / `summaryCommented` on a run and refreshes its index entry; no-op when the run is unknown. */
  annotateRun(runId: string, meta: RunMeta): Promise<void>;
  runs(q?: RunQuery): Promise<RunIndexEntry[]>;
  run(runId: string): Promise<RunIndexEntry | undefined>;
  records(runId: string): AsyncIterable<DerivedRecord>;
  countSince(ts: string): Promise<number>;
  spendByDay(days: number, profile?: Profile): Promise<SpendDay[]>;
}

/** Derived record: one JSON object per line in runs/<runId>.jsonl. */
export interface DerivedRecord {
  type: string;
  runId?: string;
  t: string;
  [key: string]: unknown;
}
