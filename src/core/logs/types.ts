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
}

export interface IngestResult {
  runsUpdated: number;
  records: number;
  /** Transcript/hook lines that were not mapped to a derived record (unknown types, malformed JSON). */
  skipped: number;
}

export interface LogService {
  ingest(opts?: IngestOptions): Promise<IngestResult>;
  appendHookEvent(event: HookEvent): void;
}

/** Derived record: one JSON object per line in runs/<runId>.jsonl. */
export interface DerivedRecord {
  type: string;
  runId?: string;
  t: string;
  [key: string]: unknown;
}
