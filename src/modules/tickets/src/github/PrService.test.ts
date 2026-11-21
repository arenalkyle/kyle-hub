import { describe, expect, it, vi } from "vitest";
import type { PrInfo } from "../core/pr";
import { defaultData } from "../data";
import { GhError } from "./gh";
import { MAX_CONCURRENT, PrService } from "./PrService";

const info = (n: number, state: PrInfo["state"] = "open"): PrInfo => ({
  owner: "a", repo: "b", number: n, url: `https://github.com/a/b/pull/${n}`, title: `t${n}`, state,
});
const urls = (k: number) => Array.from({ length: k }, (_, i) => `https://github.com/a/b/pull/${i + 1}`);

function make(fetcher: (u: string) => Promise<PrInfo>, all: string[] = []) {
  const data = defaultData();
  let t = 1_000_000;
  const svc = new PrService({ data, savePluginData: async () => {}, allPrUrls: () => all }, (u) => fetcher(u), () => t);
  return { svc, data, advance: (ms: number) => (t += ms) };
}

describe("PrService", () => {
  it("caches and only refetches stale entries", async () => {
    const f = vi.fn(async (u: string) => info(Number(u.split("/").pop())));
    const { svc, advance } = make(f);
    await svc.ensure(urls(2));
    expect(f).toHaveBeenCalledTimes(2);
    expect(svc.get(urls(1)[0]!)?.title).toBe("t1");
    await svc.ensure(urls(2));
    expect(f).toHaveBeenCalledTimes(2);
    advance(11 * 60_000);
    await svc.ensure(urls(2));
    expect(f).toHaveBeenCalledTimes(4);
  });

  it("limits concurrency to 4", async () => {
    let cur = 0;
    let max = 0;
    const f = async (u: string) => {
      cur++;
      max = Math.max(max, cur);
      await new Promise((r) => setTimeout(r, 5));
      cur--;
      return info(Number(u.split("/").pop()));
    };
    const { svc } = make(f);
    await svc.ensure(urls(12));
    expect(max).toBe(MAX_CONCURRENT);
  });

  it("stops calling gh after not-installed, silently", async () => {
    const f = vi.fn(async () => {
      throw new GhError("not-installed", "x");
    });
    const { svc } = make(f);
    await svc.ensure(urls(5));
    await svc.ensure(urls(5), true);
    expect(f.mock.calls.length).toBeLessThanOrEqual(MAX_CONCURRENT);
    svc.resetAvailability();
    await svc.ensure(urls(1));
    expect(f.mock.calls.length).toBeGreaterThan(0);
  });

  it("background refresh skips merged/closed", async () => {
    const f = vi.fn(async (u: string) => info(Number(u.split("/").pop()), "open"));
    const all = urls(3);
    const { svc, data, advance } = make(f, all);
    data.prCache[all[0]!] = { info: info(1, "merged"), fetchedAt: 0 };
    data.prCache[all[1]!] = { info: info(2, "closed"), fetchedAt: 0 };
    await svc.refreshAll();
    expect(f).toHaveBeenCalledTimes(1);
    advance(60_000);
    await svc.refreshAll();
    expect(f).toHaveBeenCalledTimes(1);
    advance(11 * 60_000);
    await svc.refreshAll();
    expect(f).toHaveBeenCalledTimes(2);
  });
});
