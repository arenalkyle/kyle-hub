import { describe, expect, it, vi } from "vitest";
import { defaultData } from "../data";
import { AutoLinker, parseListedPrs, type AutoLinkHost } from "./autolink";

const pr = (n: number, title: string, head = "") => ({ number: n, title, headRefName: head, url: `https://github.com/o/r/pull/${n}`, state: "OPEN", isDraft: false });

function setup(lists: unknown[][]) {
  const data = defaultData();
  data.settings.autoLinkPrs = true;
  data.settings.ghRepos = ["o/r"];
  const linkPr = vi.fn(async () => undefined);
  const seed = vi.fn();
  const host: AutoLinkHost = {
    data,
    savePluginData: async () => undefined,
    store: { getIssues: () => [{ id: "TIX-1", pullRequests: [] }, { id: "TIX-12", pullRequests: [] }], linkPr },
    prs: { seed },
  };
  let i = 0;
  const gh = vi.fn(async (_a: readonly string[], _o?: unknown) => JSON.stringify(lists[i++ % lists.length]));
  return { host, gh, linkPr, seed, data };
}

describe("AutoLinker", () => {
  it("links by title and branch with author github, de-duplicated across both lists", async () => {
    const { host, gh, linkPr, seed } = setup([[pr(1, "TIX-1 test")], [pr(1, "TIX-1 test"), pr(3, "x", "tix-12-a")]]);
    const r = await new AutoLinker(host, gh).sync();
    expect(r).toMatchObject({ ok: true, linked: 2 });
    expect(linkPr).toHaveBeenCalledWith("TIX-1", "https://github.com/o/r/pull/1", "github");
    expect(linkPr).toHaveBeenCalledWith("TIX-12", "https://github.com/o/r/pull/3", "github");
    expect(seed.mock.calls[0]![0]).toHaveLength(2);
    expect(gh.mock.calls[0]![0]).toContain("TIX-");
    expect(host.data.autoLink?.message).toBe("Linked 2 PRs");
  });
  it("reports gh errors", async () => {
    const { host, linkPr } = setup([[]]);
    const r = await new AutoLinker(host, async () => Promise.reject(new Error("boom"))).sync();
    expect(r).toMatchObject({ ok: false });
    expect(host.data.autoLink?.ok).toBe(false);
    expect(linkPr).not.toHaveBeenCalled();
  });
  it("runs one sync at a time and not after stop", async () => {
    const { host, gh } = setup([[]]);
    const a = new AutoLinker(host, gh);
    const p = a.sync();
    expect(await a.sync()).toBeNull();
    await p;
    a.stop();
    expect(await a.sync()).toBeNull();
  });
  it("tick respects enabled flag and interval", async () => {
    const { host, gh, data } = setup([[]]);
    let t = 1_000_000;
    const a = new AutoLinker(host, gh, () => t);
    data.settings.autoLinkPrs = false;
    await a.tick();
    expect(gh).not.toHaveBeenCalled();
    data.settings.autoLinkPrs = true;
    await a.tick();
    const n = gh.mock.calls.length;
    await a.tick();
    expect(gh.mock.calls.length).toBe(n);
    t += data.settings.prRefreshMinutes * 60_000;
    await a.tick();
    expect(gh.mock.calls.length).toBeGreaterThan(n);
  });
});

describe("parseListedPrs", () => {
  it("maps state and skips non-github urls", () => {
    const out = parseListedPrs(JSON.stringify([{ ...pr(1, "a"), state: "MERGED" }, { ...pr(2, "b"), url: "https://x.com/a" }]));
    expect(out).toHaveLength(1);
    expect(out[0]!.state).toBe("merged");
  });
});
