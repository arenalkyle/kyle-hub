import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { dataDir } from "../paths";
import { makeRedactor } from "../redact";
import { parseTranscriptLine, type ParseState } from "./parse";
import { countSince as countIndexSince, mergeIndex, queryRuns, readIndex, spendByDay as spendIndexByDay, summarizeRun, writeIndexAtomic } from "./runIndex";
import { DEFAULT_RETENTION, sweepProfile, type RetentionPolicy, type SweepResult } from "./retention";
import { PROFILES, type DerivedRecord, type HookEvent, type IngestOptions, type IngestResult, type LogService, type PriceTable, type Profile, type RepoMapEntry, type RunIndexEntry, type RunMeta, type RunQuery, type SpendDay } from "./types";

const STATE_VERSION = 1;
const HEAD_BYTES = 64 * 1024;

interface TranscriptEntry {
  offset: number;
  cwd?: string;
  parse: ParseState;
}

interface SessionEntry {
  runId: string;
  ticketId?: string;
  cwd?: string;
  repo?: string;
  profile: Profile;
  accountId?: string;
  model?: string;
  start: string;
  end: string;
}

interface State {
  version: typeof STATE_VERSION;
  lastIngest?: string;
  transcripts: Record<string, TranscriptEntry>;
  hooks: Record<string, number>;
  sessions: Record<string, SessionEntry>;
}

export interface LogServiceOptions {
  /** Profile data root; default `%LOCALAPPDATA%\kyle-hub\<profile>`. */
  dataRoot?: (profile: Profile) => string;
  /** Claude projects dir; default `$CLAUDE_CONFIG_DIR/projects` or `~/.claude/projects`. */
  projectsDir?: string;
  /** Extra Claude accounts: each `<configDir>/projects` is ingested and its records tagged with the account id. */
  accounts?: readonly { id: string; configDir: string }[] | (() => readonly { id: string; configDir: string }[]);
  repoMap?: readonly RepoMapEntry[];
  denylist?: readonly string[];
  prices?: PriceTable;
  now?: () => Date;
  retention?: Partial<RetentionPolicy>;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const accountList = (a: LogServiceOptions["accounts"]): readonly { id: string; configDir: string }[] => (typeof a === "function" ? a() : (a ?? []));

export function defaultProjectsDir(env: Record<string, string | undefined> = process.env): string {
  return path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
}

const normPath = (p: string): string => path.resolve(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** Longest repo-map prefix wins; unmatched or missing cwd → home. */
export function resolveRepo(cwd: string | undefined, repoMap: readonly RepoMapEntry[]): { profile: Profile; repo?: string } {
  if (!cwd) return { profile: "home" };
  const c = normPath(cwd);
  let best: RepoMapEntry | undefined;
  for (const e of repoMap) {
    const p = normPath(e.path);
    if ((c === p || c.startsWith(`${p}/`)) && (!best || p.length > normPath(best.path).length)) best = e;
  }
  return best ? { profile: best.profile, repo: best.name ?? path.basename(cwd) } : { profile: "home", repo: path.basename(cwd) };
}

/** Reads complete lines from `start`; a trailing partial line is left for the next ingest. */
export async function readNewLines(file: string, start: number): Promise<{ lines: string[]; consumed: number }> {
  const lines: string[] = [];
  let consumed = 0;
  let rest: Buffer = Buffer.alloc(0);
  await new Promise<void>((resolve, reject) => {
    const rs = fs.createReadStream(file, { start });
    rs.on("data", (chunk: string | Buffer) => {
      const data = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      const buf = rest.length > 0 ? Buffer.concat([rest, data]) : data;
      let from = 0;
      let idx = buf.indexOf(0x0a, from);
      while (idx !== -1) {
        lines.push(buf.subarray(from, idx).toString("utf8"));
        consumed += idx - from + 1;
        from = idx + 1;
        idx = buf.indexOf(0x0a, from);
      }
      rest = Buffer.from(buf.subarray(from));
    });
    rs.on("end", () => resolve());
    rs.on("error", reject);
  });
  return { lines: lines.map((l) => l.replace(/\r$/, "")), consumed };
}

/** The cwd recorded on the first transcript line that has one (scans a bounded head). */
async function headCwd(file: string): Promise<string | undefined> {
  let fh: fs.promises.FileHandle | undefined;
  try {
    fh = await fs.promises.open(file, "r");
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
    for (const line of buf.subarray(0, bytesRead).toString("utf8").split("\n")) {
      try {
        const o: unknown = JSON.parse(line);
        if (isObj(o) && typeof o.cwd === "string") return o.cwd;
      } catch {
        // partial or non-JSON line
      }
    }
    return undefined;
  } finally {
    await fh?.close();
  }
}

async function listTranscripts(projectsDir: string): Promise<string[]> {
  const out: string[] = [];
  const projects = await fs.promises.readdir(projectsDir, { withFileTypes: true }).catch(() => []);
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    const dir = path.join(projectsDir, p.name);
    const names = await fs.promises.readdir(dir).catch(() => []);
    for (const n of names) if (n.endsWith(".jsonl")) out.push(path.join(dir, n));
  }
  return out.sort();
}

async function readEnvValues(cwd: string): Promise<string[]> {
  const names = await fs.promises.readdir(cwd).catch(() => []);
  const values: string[] = [];
  for (const n of names.filter((x) => /^\.env/.test(x))) {
    const text = await fs.promises.readFile(path.join(cwd, n), "utf8").catch(() => "");
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const v = (m[1] ?? "").trim().replace(/^(["'])(.*)\1$/, "$2");
      if (v.length > 0) values.push(v);
    }
  }
  return values;
}

async function loadState(dir: string): Promise<State> {
  const empty: State = { version: STATE_VERSION, transcripts: {}, hooks: {}, sessions: {} };
  const raw = await fs.promises.readFile(path.join(dir, "state.json"), "utf8").catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return undefined;
    throw e;
  });
  if (raw === undefined) return empty;
  const parsed: unknown = JSON.parse(raw);
  if (!isObj(parsed) || parsed.version !== STATE_VERSION) throw new Error(`kh logs: unsupported state.json in ${dir}`);
  return { ...empty, ...(parsed as Partial<State>) };
}

async function saveState(dir: string, state: State): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, "state.json");
  await fs.promises.writeFile(`${file}.tmp`, JSON.stringify(state, null, 2));
  await fs.promises.rename(`${file}.tmp`, file);
}

function redactDeep(v: unknown, fn: (s: string) => string): unknown {
  if (typeof v === "string") return fn(v);
  if (Array.isArray(v)) return v.map((x) => redactDeep(x, fn));
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactDeep(x, fn)]));
  return v;
}

/** Records gathered during one ingest of one profile, flushed per run. */
class Batch {
  readonly headers = new Map<string, DerivedRecord>();
  readonly records = new Map<string, DerivedRecord[]>();
  readonly cwdByRun = new Map<string, string | undefined>();

  header(runId: string, rec: DerivedRecord, cwd: string | undefined): void {
    if (!this.headers.has(runId)) this.headers.set(runId, { ...rec, runId });
    this.cwdByRun.set(runId, cwd);
  }

  push(runId: string, rec: DerivedRecord): void {
    const list = this.records.get(runId) ?? [];
    list.push({ ...rec, runId });
    this.records.set(runId, list);
  }
}

export class FileLogService implements LogService {
  private readonly now: () => Date;
  private readonly repoMap: readonly RepoMapEntry[];
  private readonly projectsDir: string;

  constructor(private readonly opts: LogServiceOptions = {}) {
    this.now = opts.now ?? (() => new Date());
    this.repoMap = opts.repoMap ?? [];
    this.projectsDir = opts.projectsDir ?? defaultProjectsDir();
  }

  /** Transcripts of the default projects dir (untagged) and of every account's `<configDir>/projects` (tagged). Reads only `*.jsonl` under `projects`. */
  private async transcriptSources(): Promise<{ file: string; accountId?: string }[]> {
    const seen = new Set<string>();
    const out: { file: string; accountId?: string }[] = [];
    const dirs: { dir: string; accountId?: string }[] = [
      ...accountList(this.opts.accounts).map((a) => ({ dir: path.join(a.configDir, "projects"), accountId: a.id })),
      { dir: this.projectsDir },
    ];
    for (const { dir, accountId } of dirs) {
      const key = normPath(dir);
      if (seen.has(key)) continue;
      seen.add(key);
      for (const file of await listTranscripts(dir)) out.push({ file, accountId });
    }
    return out;
  }

  private dirFor(profile: Profile): string {
    return this.opts.dataRoot ? this.opts.dataRoot(profile) : dataDir(profile);
  }

  /** Incremental ingest: transcripts from stored offsets, hook spool, then derived records per run. */
  async ingest(ingestOpts: IngestOptions = {}): Promise<IngestResult> {
    const result: IngestResult = { runsUpdated: 0, records: 0, skipped: 0 };
    const files = await Promise.all(
      (await this.transcriptSources()).map(async ({ file, accountId }) => {
        const cwd = await headCwd(file);
        return { file, cwd, accountId, ...resolveRepo(cwd, this.repoMap) };
      }),
    );
    const profiles = ingestOpts.profile ? [ingestOpts.profile] : PROFILES;
    for (const profile of profiles) {
      const dir = this.dirFor(profile);
      const state = await loadState(dir);
      const batch = new Batch();
      let changed = await this.mergeHooks(dir, state, batch, profile, result);
      for (const f of files) {
        if (f.profile !== profile) continue;
        if (ingestOpts.sessionId && path.basename(f.file, ".jsonl") !== ingestOpts.sessionId) continue;
        changed = (await this.ingestFile(f.file, f.cwd, profile, f.accountId, state, batch, result)) || changed;
      }
      const touched = await this.flush(dir, batch, result);
      if (touched.length > 0) this.updateIndex(dir, touched);
      if (changed) {
        state.lastIngest = this.now().toISOString();
        await saveState(dir, state);
      }
    }
    return result;
  }

  async annotateRun(runId: string, meta: RunMeta): Promise<void> {
    for (const profile of PROFILES) {
      const dir = this.dirFor(profile);
      const file = path.join(dir, "runs", `${runId}.jsonl`);
      if (!fs.existsSync(file)) continue;
      const rec: DerivedRecord = { type: "run_meta", t: this.now().toISOString(), runId, ...meta };
      fs.appendFileSync(file, `${JSON.stringify(rec)}
`);
      this.updateIndex(dir, [runId]);
      return;
    }
  }

  /** Rebuilds the index entries of the touched runs from their files and rewrites index.jsonl atomically. */
  private updateIndex(dir: string, runIds: readonly string[]): void {
    const updates: RunIndexEntry[] = [];
    for (const runId of runIds) {
      const text = fs.readFileSync(path.join(dir, "runs", `${runId}.jsonl`), "utf8");
      const recs = text.split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l) as DerivedRecord);
      const entry = summarizeRun(runId, recs);
      if (entry) updates.push(entry);
    }
    if (updates.length > 0) writeIndexAtomic(dir, mergeIndex(readIndex(dir), updates));
  }

  private allIndex(): RunIndexEntry[] {
    return PROFILES.flatMap((p) => readIndex(this.dirFor(p)));
  }

  /** Index entries across profiles, newest first. */
  async runs(q: RunQuery = {}): Promise<RunIndexEntry[]> {
    return queryRuns(this.allIndex(), q);
  }

  async run(runId: string): Promise<RunIndexEntry | undefined> {
    return this.allIndex().find((e) => e.runId === runId);
  }

  /** Streams one run's redacted derived records from `runs/<runId>.jsonl`. */
  async *records(runId: string): AsyncIterable<DerivedRecord> {
    const file = PROFILES.map((p) => path.join(this.dirFor(p), "runs", `${runId}.jsonl`)).find((f) => fs.existsSync(f));
    if (!file) return;
    const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (line.trim().length > 0) yield JSON.parse(line) as DerivedRecord;
    }
  }

  async countSince(ts: string): Promise<number> {
    return countIndexSince(this.allIndex(), ts);
  }

  async spendByDay(days: number, profile?: Profile): Promise<SpendDay[]> {
    const all = this.allIndex();
    return spendIndexByDay(profile ? all.filter((e) => e.profile === profile) : all, days, this.now());
  }

  /** Removes (or with `dryRun`, only lists) data past retention in every profile. */
  async sweep(opts: { dryRun?: boolean } = {}): Promise<SweepResult[]> {
    const policy: RetentionPolicy = { ...DEFAULT_RETENTION, ...this.opts.retention };
    const out: SweepResult[] = [];
    for (const profile of PROFILES) {
      const dir = this.dirFor(profile);
      const state = await loadState(dir);
      out.push(sweepProfile(dir, this.now(), policy, opts.dryRun === true, state.hooks));
    }
    return out;
  }

  /** Writes a raw hook event to the profile's hook spool; never throws (hooks must not fail Claude Code). */
  appendHookEvent(event: HookEvent): void {
    try {
      if (!event.sessionId || !event.name) return;
      const t = event.t ?? this.now().toISOString();
      const profile = event.profile ?? resolveRepo(event.cwd, this.repoMap).profile;
      const dir = path.join(this.dirFor(profile), "hooks");
      fs.mkdirSync(dir, { recursive: true });
      const line = JSON.stringify({ t, sessionId: event.sessionId, name: event.name, state: event.state, runId: event.runId, ticketId: event.ticketId, accountId: event.accountId, cwd: event.cwd });
      fs.appendFileSync(path.join(dir, `${t.slice(0, 10)}.jsonl`), `${line}\n`);
    } catch {
      // swallowed on purpose: a failing log write must never break a hook
    }
  }

  private ensureSession(state: State, batch: Batch, sid: string, cwd: string | undefined, profile: Profile, t: string, accountId?: string): SessionEntry {
    const existing = state.sessions[sid];
    if (existing) {
      if (!existing.cwd && cwd) {
        existing.cwd = cwd;
        existing.repo = resolveRepo(cwd, this.repoMap).repo;
        batch.cwdByRun.set(existing.runId, cwd);
      }
      return existing;
    }
    const { repo } = resolveRepo(cwd, this.repoMap);
    const s: SessionEntry = { runId: `s-${sid}`, cwd, repo, profile, start: t, end: t };
    if (accountId) s.accountId = accountId;
    state.sessions[sid] = s;
    batch.header(s.runId, { type: "run", t, sessionId: sid, cwd, repo, profile, ...(accountId ? { accountId } : {}) }, cwd);
    return s;
  }

  private async mergeHooks(dir: string, state: State, batch: Batch, profile: Profile, result: IngestResult): Promise<boolean> {
    const hookDir = path.join(dir, "hooks");
    const names = (await fs.promises.readdir(hookDir).catch(() => [])).filter((n) => n.endsWith(".jsonl")).sort();
    let changed = false;
    for (const name of names) {
      const file = path.join(hookDir, name);
      const { lines, consumed } = await readNewLines(file, state.hooks[name] ?? 0);
      for (const line of lines) {
        if (line.trim().length === 0) continue;
        let e: unknown;
        try {
          e = JSON.parse(line);
        } catch {
          result.skipped++;
          continue;
        }
        if (!isObj(e) || typeof e.sessionId !== "string" || typeof e.name !== "string") {
          result.skipped++;
          continue;
        }
        const t = typeof e.t === "string" ? e.t : this.now().toISOString();
        const cwd = typeof e.cwd === "string" ? e.cwd : undefined;
        const s = this.ensureSession(state, batch, e.sessionId, cwd, profile, t);
        if (typeof e.runId === "string" && e.runId !== s.runId) {
          s.runId = e.runId;
          batch.header(s.runId, { type: "run", t: s.start, sessionId: e.sessionId, cwd: s.cwd, repo: s.repo, profile, ...(s.accountId ? { accountId: s.accountId } : {}) }, s.cwd);
        }
        if (typeof e.accountId === "string" && e.accountId !== s.accountId) {
          s.accountId = e.accountId;
          batch.push(s.runId, { type: "run_meta", t, accountId: e.accountId });
        }
        if (typeof e.ticketId === "string" && e.ticketId !== s.ticketId) {
          s.ticketId = e.ticketId;
          batch.push(s.runId, { type: "run_meta", t, ticketId: e.ticketId });
        }
        const rec: DerivedRecord = { type: "hook", t, name: e.name };
        if (typeof e.state === "string") rec.state = e.state;
        batch.push(s.runId, rec);
        if (t > s.end) s.end = t;
        batch.cwdByRun.set(s.runId, s.cwd);
        result.records++;
      }
      if (consumed > 0) {
        state.hooks[name] = (state.hooks[name] ?? 0) + consumed;
        changed = true;
      }
    }
    return changed;
  }

  private async ingestFile(file: string, headCwdValue: string | undefined, profile: Profile, accountId: string | undefined, state: State, batch: Batch, result: IngestResult): Promise<boolean> {
    const entry: TranscriptEntry = state.transcripts[file] ?? { offset: 0, cwd: headCwdValue, parse: { pending: {} } };
    const { lines, consumed } = await readNewLines(file, entry.offset).catch(() => ({ lines: [] as string[], consumed: 0 }));
    const fallbackSid = path.basename(file, ".jsonl");
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        result.skipped++;
        continue;
      }
      const sid = isObj(obj) && typeof obj.sessionId === "string" ? obj.sessionId : fallbackSid;
      const cwd = (isObj(obj) && typeof obj.cwd === "string" ? obj.cwd : undefined) ?? entry.cwd;
      const recs = parseTranscriptLine(obj, { sessionId: sid, cwd, profile, prices: this.opts.prices, state: entry.parse });
      if (recs === undefined) {
        result.skipped++;
        continue;
      }
      if (recs.length === 0) continue;
      const s = this.ensureSession(state, batch, sid, cwd, profile, recs[0]?.t ?? "", accountId);
      for (const r of recs) {
        batch.push(s.runId, r);
        batch.cwdByRun.set(s.runId, s.cwd);
        result.records++;
        if (r.type === "usage" && typeof r.model === "string") s.model = r.model;
        if (r.t > s.end) s.end = r.t;
      }
    }
    if (consumed === 0) return false;
    entry.offset += consumed;
    entry.cwd = entry.cwd ?? headCwdValue;
    state.transcripts[file] = entry;
    return true;
  }

  /** Redacts and appends each run's records; a run file gets its header on creation only. */
  private async flush(dir: string, batch: Batch, result: IngestResult): Promise<string[]> {
    if (batch.records.size === 0 && batch.headers.size === 0) return [];
    const runsDir = path.join(dir, "runs");
    await fs.promises.mkdir(runsDir, { recursive: true });
    await fs.promises.mkdir(path.join(dir, "packs"), { recursive: true });
    const redactors = new Map<string, (s: string) => string>();
    const touched: string[] = [];
    for (const [runId, recs] of batch.records) {
      const cwd = batch.cwdByRun.get(runId);
      const key = cwd ?? "";
      let fn = redactors.get(key);
      if (!fn) {
        const envValues = cwd ? await readEnvValues(cwd) : [];
        fn = makeRedactor({ envValues, denylist: this.opts.denylist ?? [] });
        redactors.set(key, fn);
      }
      const file = path.join(runsDir, `${runId}.jsonl`);
      const isNew = !fs.existsSync(file);
      const lines: string[] = [];
      const header = batch.headers.get(runId);
      if (isNew && header) lines.push(JSON.stringify(redactDeep(header, fn)));
      for (const r of recs) lines.push(JSON.stringify(redactDeep(r, fn)));
      await fs.promises.appendFile(file, `${lines.join("\n")}\n`);
      touched.push(runId);
    }
    result.runsUpdated += touched.length;
    return touched;
  }
}
