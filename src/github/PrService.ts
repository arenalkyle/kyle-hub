import { isStale, type PrCacheEntry, type PrInfo } from "../core/pr";
import type { PluginData } from "../data";
import { getPr, type GhError, type GhErrorKind } from "./gh";

export const MAX_CONCURRENT = 4;

export interface PrHost {
  data: PluginData;
  savePluginData(): Promise<void>;
  /** PR urls of all issues. */
  allPrUrls(): string[];
}

export type PrFetcher = (url: string, bin: string) => Promise<PrInfo>;

/** Live PR state: cache in plugin data, bounded-concurrency fetching, silent on `gh` problems. */
export class PrService {
  private readonly listeners = new Set<() => void>();
  private readonly inflight = new Map<string, Promise<void>>();
  private version = 0;
  private active = 0;
  private readonly queue: (() => void)[] = [];
  /** Set after a not-installed / not-authenticated failure; cleared by `resetAvailability`. */
  private blocked: GhErrorKind | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly host: PrHost,
    private readonly fetcher: PrFetcher = (url, bin) => getPr(url, { bin }),
    private readonly now: () => number = Date.now,
  ) {}

  private cache(): Record<string, PrCacheEntry> {
    return this.host.data.prCache;
  }

  get(url: string): PrInfo | undefined {
    return this.cache()[url]?.info;
  }

  getVersion(): number {
    return this.version;
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(): void {
    this.version++;
    for (const l of [...this.listeners]) l();
  }

  /** Call after the user re-checks `gh` or changes its path, so fetching resumes. */
  resetAvailability(): void {
    this.blocked = null;
  }

  private intervalMs(): number {
    return Math.max(1, this.host.data.settings.prRefreshMinutes) * 60_000;
  }

  /** Fetches urls that are missing or older than the interval (or all, when `force`). */
  async ensure(urls: readonly string[], force = false): Promise<void> {
    const t = this.now();
    const todo = [...new Set(urls)].filter((u) => force || isStale(this.cache()[u], t, this.intervalMs()));
    await Promise.all(todo.map((u) => this.fetchOne(u)));
  }

  /** Background refresh: issues' PRs that are uncached or not yet merged/closed and stale. */
  async refreshAll(): Promise<void> {
    const t = this.now();
    const urls = this.host.allPrUrls().filter((u) => {
      const e = this.cache()[u];
      if (!e) return true;
      if (e.info.state === "merged" || e.info.state === "closed") return false;
      return isStale(e, t, this.intervalMs());
    });
    await this.ensure(urls, true);
  }

  /** Stores PR info obtained elsewhere (auto-link listing) in the cache, only for already-known or given urls. */
  seed(infos: readonly PrInfo[]): void {
    if (infos.length === 0) return;
    const t = this.now();
    for (const info of infos) this.cache()[info.url] = { info, fetchedAt: t };
    this.scheduleSave();
    this.emit();
  }

  private fetchOne(url: string): Promise<void> {
    if (this.blocked) return Promise.resolve();
    const existing = this.inflight.get(url);
    if (existing) return existing;
    const p = this.limited(async () => {
      if (this.blocked) return;
      try {
        const info = await this.fetcher(url, this.host.data.settings.ghPath);
        this.cache()[url] = { info, fetchedAt: this.now() };
        this.scheduleSave();
        this.emit();
      } catch (e) {
        const kind = (e as GhError).kind;
        if (kind === "not-installed" || kind === "not-authenticated") this.blocked = kind;
        // Anything else (not-found, timeout, ...) leaves the plain link in place; never log per PR.
      }
    }).finally(() => {
      this.inflight.delete(url);
    });
    this.inflight.set(url, p);
    return p;
  }

  private async limited(fn: () => Promise<void>): Promise<void> {
    if (this.active >= MAX_CONCURRENT) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.host.savePluginData().catch(() => undefined);
    }, 2000);
  }

  stop(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      void this.host.savePluginData().catch(() => undefined);
    }
    this.listeners.clear();
  }
}
