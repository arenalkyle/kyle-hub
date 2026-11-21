import { parsePrUrl, toPrState, type PrInfo } from "../core/pr";
import { planLinks, type CandidatePr, type LinkTarget } from "../core/prMatch";
import type { PluginData } from "../data";
import { GhError, runGh, type RunGhOptions } from "./gh";

const FIELDS = "number,title,headRefName,url,state,isDraft,updatedAt";

interface RawListedPr {
  number: number;
  title: string;
  headRefName?: string;
  url: string;
  state: string;
  isDraft?: boolean;
}

export type GhRunner = (args: readonly string[], opts?: RunGhOptions) => Promise<string>;

export interface AutoLinkHost {
  data: PluginData;
  savePluginData(): Promise<void>;
  store: {
    getIssues(): readonly LinkTarget[];
    linkPr(id: string, url: string, author?: string): Promise<unknown>;
  };
  prs: { seed(infos: readonly PrInfo[]): void };
}

export interface SyncResult {
  ok: boolean;
  linked: number;
  message: string;
}

export function parseListedPrs(out: string): (PrInfo & CandidatePr)[] {
  const raw = JSON.parse(out) as RawListedPr[];
  const res: (PrInfo & CandidatePr)[] = [];
  for (const r of raw) {
    const ref = parsePrUrl(r.url);
    if (!ref) continue;
    res.push({ ...ref, title: r.title ?? "", headRefName: r.headRefName, state: toPrState(r.state ?? "OPEN", r.isDraft === true) });
  }
  return res;
}

/** Periodically links PRs of watched repos to issues whose ID is in the PR title or branch. One sync at a time. */
export class AutoLinker {
  private running = false;
  private stopped = false;
  private lastRun = 0;

  constructor(
    private readonly host: AutoLinkHost,
    private readonly gh: GhRunner = runGh,
    private readonly now: () => number = Date.now,
  ) {}

  /** Background tick: syncs when enabled and the refresh interval has elapsed since the last run. */
  async tick(): Promise<void> {
    const s = this.host.data.settings;
    if (!s.autoLinkPrs || s.ghRepos.length === 0) return;
    if (this.now() - this.lastRun < Math.max(1, s.prRefreshMinutes) * 60_000) return;
    await this.sync();
  }

  /** Lists PRs of every watched repo and links matches. Returns `null` when a sync is already running. */
  async sync(): Promise<SyncResult | null> {
    if (this.running || this.stopped) return null;
    this.running = true;
    this.lastRun = this.now();
    try {
      const result = await this.run();
      this.host.data.autoLink = { at: this.now(), ok: result.ok, message: result.message };
      await this.host.savePluginData().catch(() => undefined);
      return result;
    } finally {
      this.running = false;
    }
  }

  private async run(): Promise<SyncResult> {
    const s = this.host.data.settings;
    const repos = s.ghRepos.map((r) => r.trim()).filter(Boolean);
    if (repos.length === 0) return { ok: false, linked: 0, message: "No repos to watch." };
    const opts: RunGhOptions = { bin: s.ghPath, timeoutMs: 30000 };
    const byUrl = new Map<string, PrInfo & CandidatePr>();
    let linked = 0;
    try {
      for (const repo of repos) {
        // GitHub search does not index branch names: the search narrows by title, the open list is matched locally on branches.
        const searched = await this.gh(["pr", "list", "--repo", repo, "--state", "all", "--limit", "100", "--search", `${s.prefix}-`, "--json", FIELDS], opts);
        const open = await this.gh(["pr", "list", "--repo", repo, "--state", "open", "--limit", "100", "--json", FIELDS], opts);
        for (const p of [...parseListedPrs(searched), ...parseListedPrs(open)]) byUrl.set(p.url, p);
      }
      if (this.stopped) return { ok: false, linked, message: "Stopped." };
      const prs = [...byUrl.values()];
      const plan = planLinks(prs, this.host.store.getIssues(), this.host.data.settings.unlinkedPrs, s.prefix);
      const planned = new Set(plan.map((l) => l.url));
      this.host.prs.seed(prs.filter((p) => planned.has(p.url)));
      for (const l of plan) {
        if (this.stopped) break;
        await this.host.store.linkPr(l.issueId, l.url, "github");
        linked++;
      }
    } catch (e) {
      const msg = e instanceof GhError || e instanceof Error ? e.message : String(e);
      return { ok: false, linked, message: `Error: ${msg.split("\n")[0]}` };
    }
    return { ok: true, linked, message: `Linked ${linked} PR${linked === 1 ? "" : "s"}` };
  }

  stop(): void {
    this.stopped = true;
  }
}
