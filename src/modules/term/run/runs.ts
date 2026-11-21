/** A launched run, as tracked while its session is live. */
export interface RunInfo {
  ticketId: string;
  runId: string;
  sessionId: string;
  /** Epoch ms. */
  startedAt: number;
  /** Directory the session runs in (a worktree, or the repo when worktrees are off). */
  worktree: string;
  /** Commit the run started from; the diff and commit list are taken against it. */
  base?: string;
  branch?: string;
  repoPath?: string;
}

const RUN_ID = /^r-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(.+)$/;

/** Parses `r-<YYYYMMDD-HHmmss>-<ID>` (local time) back into its start time and ticket id. */
export function parseRunId(runId: string): { startedAt: number; ticketId: string } | undefined {
  const m = RUN_ID.exec(runId);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s, id] = m;
  return { startedAt: new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).getTime(), ticketId: id! };
}

/** Terminal session id -> run. Rebuilt from hook env (`KH_RUN`, `KH_TICKET`) after an Obsidian restart. */
export class RunRegistry {
  private readonly bySession = new Map<string, RunInfo>();

  register(run: RunInfo): void {
    this.bySession.set(run.sessionId, run);
  }

  get(sessionId: string): RunInfo | undefined {
    return this.bySession.get(sessionId);
  }

  forget(sessionId: string): void {
    this.bySession.delete(sessionId);
  }

  list(): RunInfo[] {
    return [...this.bySession.values()];
  }

  /** The run of a hook event carrying `KH_RUN`; learns it when the launch map has no entry (restart). */
  fromHook(sessionId: string, env: Record<string, string> | undefined, cwd: string | undefined): RunInfo | undefined {
    const known = this.bySession.get(sessionId);
    if (known) return known;
    const runId = env?.KH_RUN;
    if (!runId) return undefined;
    const parsed = parseRunId(runId);
    const ticketId = env?.KH_TICKET || parsed?.ticketId;
    if (!ticketId) return undefined;
    const run: RunInfo = { ticketId, runId, sessionId, startedAt: parsed?.startedAt ?? Date.now(), worktree: cwd ?? "" };
    this.bySession.set(sessionId, run);
    return run;
  }
}
