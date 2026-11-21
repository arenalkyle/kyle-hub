import { patchIssueText } from "../core/ops";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultData } from "../data";
import { IssueStore } from "./IssueStore";

type Handler = (...a: any[]) => void;

class FakeVault {
  files = new Map<string, string>();
  private handlers = new Map<string, Handler[]>();
  on(name: string, h: Handler) {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), h]);
    return { name, h };
  }
  fire(name: string, ...a: unknown[]) {
    for (const h of this.handlers.get(name) ?? []) h(...a);
  }
  file(path: string) {
    return this.files.has(path) ? { path, name: path.split("/").pop()!, stat: {} } : null;
  }
  getAbstractFileByPath = (p: string) =>
    this.file(p) ?? (p.endsWith("Issues") || p.endsWith("Projects") ? { path: p } : null);
  getMarkdownFiles = () => [...this.files.keys()].map((p) => this.file(p)!);
  read = async (f: { path: string }) => this.files.get(f.path)!;
  createFolder = async () => {};
  create = async (p: string, t: string) => {
    this.files.set(p, t);
    this.fire("create", this.file(p));
  };
  process = async (f: { path: string }, fn: (t: string) => string) => {
    const out = fn(this.files.get(f.path)!);
    this.files.set(f.path, out);
    this.fire("modify", this.file(f.path));
    return out;
  };
  /** Simulate an outside edit. */
  external(p: string, t: string) {
    this.files.set(p, t);
    this.fire("modify", this.file(p));
  }
}

function setup() {
  const vault = new FakeVault();
  const data = defaultData();
  const host = {
    app: {
      vault,
      metadataCache: { on: (n: string, h: Handler) => vault.on("mc:" + n, h) },
      fileManager: {
        renameFile: async (f: { path: string }, to: string) => {
          const text = vault.files.get(f.path)!;
          vault.files.delete(f.path);
          vault.files.set(to, text);
          vault.fire("rename", vault.file(to), f.path);
        },
        trashFile: async (f: { path: string }) => {
          vault.files.delete(f.path);
          vault.fire("delete", f);
        },
      },
    },
    data,
    savePluginData: vi.fn(async () => {}),
    registerEvent: () => {},
  };
  const store = new IssueStore(host as never, 500);
  return { vault, data, host, store };
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe("IssueStore", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("creates issues with sequential ids, a created event and default status", async () => {
    const { store, vault, host } = setup();
    await store.start();
    const a = await store.createIssue({ title: "One" });
    const b = await store.createIssue({ title: "Two" });
    expect([a.id, b.id]).toEqual(["TIX-1", "TIX-2"]);
    expect(a.status).toBe("Backlog");
    expect(vault.files.get("Tickets/Issues/TIX-1.md")).toMatch(/@kyle created the issue/);
    expect(host.data.idCounter).toBe(3);
    expect(host.savePluginData).toHaveBeenCalledTimes(2);
    expect(store.getIssues()).toHaveLength(2);
    await store.deleteIssue("TIX-2");
    expect((await store.createIssue({ title: "Three" })).id).toBe("TIX-3");
  });

  it("logs store field changes and does not double-log on its own modify event", async () => {
    const { store, vault } = setup();
    await store.start();
    await store.createIssue({ title: "One" });
    await store.updateIssue("TIX-1", { status: "Todo" });
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    const text = vault.files.get("Tickets/Issues/TIX-1.md")!;
    expect(text.match(/set status: Backlog → Todo/g)).toHaveLength(1);
    expect(text).not.toMatch(/@external/);
    expect(store.getIssue("TIX-1")!.status).toBe("Todo");
  });

  it("links and unlinks PRs with activity events, canonicalizing and de-duplicating", async () => {
    const { store, vault } = setup();
    await store.start();
    await store.createIssue({ title: "One" });
    await expect(store.linkPr("TIX-1", "https://example.com/x")).rejects.toThrow(/pull request URL/);
    await store.linkPr("TIX-1", "https://github.com/a/b/pull/5/files");
    await store.linkPr("TIX-1", "https://github.com/a/b/pull/5");
    expect(store.getIssue("TIX-1")!.pullRequests).toEqual(["https://github.com/a/b/pull/5"]);
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    let text = vault.files.get("Tickets/Issues/TIX-1.md")!;
    expect(text.match(/linked PR a\/b#5/g)).toHaveLength(1);
    expect(text).not.toMatch(/@external/);
    await store.unlinkPr("TIX-1", "https://github.com/a/b/pull/5");
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    text = vault.files.get("Tickets/Issues/TIX-1.md")!;
    expect(store.getIssue("TIX-1")!.pullRequests).toEqual([]);
    expect(text).toMatch(/unlinked PR a\/b#5/);
  });

  it("bulkUpdate writes matching issues sequentially, one event each, with progress", async () => {
    const { store, vault } = setup();
    await store.start();
    for (const t of ["A", "B", "C"]) await store.createIssue({ title: t, tags: t === "C" ? [] : ["bug"] });
    const progress: Array<[number, number]> = [];
    const n = await store.bulkUpdate(
      (i) => i.tags.includes("bug"),
      (i) => ({ tags: i.tags.map((t) => (t === "bug" ? "defect" : t)) }),
      { onProgress: (d, t) => progress.push([d, t]) },
    );
    expect(n).toBe(2);
    expect(progress).toEqual([[0, 2], [1, 2], [2, 2]]);
    expect(store.getIssue("TIX-1")!.tags).toEqual(["defect"]);
    expect(store.getIssue("TIX-3")!.tags).toEqual([]);
    expect(vault.files.get("Tickets/Issues/TIX-1.md")!.match(/bug → defect|defect/g)!.length).toBeGreaterThan(0);
    expect(await store.bulkUpdate((i) => i.status === "Backlog", { status: "Todo" })).toBe(3);
    expect(vault.files.get("Tickets/Issues/TIX-2.md")!.match(/set status: Backlog → Todo/g)).toHaveLength(1);
  });

  it("appends an @external event for raw frontmatter edits, once", async () => {
    const { store, vault } = setup();
    await store.start();
    await store.createIssue({ title: "One" });
    const p = "Tickets/Issues/TIX-1.md";
    vault.external(p, vault.files.get(p)!.replace("status: Backlog", "status: Todo"));
    await flush();
    expect(store.getIssue("TIX-1")!.status).toBe("Todo"); // index is immediate
    await flush();
    vi.advanceTimersByTime(600);
    await flush();
    vi.advanceTimersByTime(2000);
    await flush();
    const text = vault.files.get(p)!;
    expect(text.match(/@external set status: Backlog → Todo/g)).toHaveLength(1);
  });

  it("does not re-log a CLI write that already carries its own event", async () => {
    const { store, vault } = setup();
    await store.start();
    await store.createIssue({ title: "One" });
    const p = "Tickets/Issues/TIX-1.md";
    vault.external(p, patchIssueText(vault.files.get(p)!, "TIX-1.md", { status: "Todo", updatedBy: "claude" }, "claude", new Date()));
    await flush();
    vi.advanceTimersByTime(600);
    await flush();
    vi.advanceTimersByTime(2000);
    await flush();
    const text = vault.files.get(p)!;
    expect(text.match(/set status: Backlog → Todo/g)).toHaveLength(1);
    expect(text).not.toMatch(/@external/);
  });

  it("attributes to updatedBy when the edit bumps it, and ignores activity-only edits", async () => {
    const { store, vault } = setup();
    await store.start();
    await store.createIssue({ title: "One" });
    const p = "Tickets/Issues/TIX-1.md";
    vault.external(
      p,
      vault
        .files.get(p)!
        .replace("status: Backlog", "status: Done\nupdatedBy: claude")
        .replace(/updated: \S+/, "updated: 2099-01-01T00:00:00"),
    );
    await flush();
    vi.advanceTimersByTime(600);
    await flush();
    expect(vault.files.get(p)).toMatch(/@claude set status: Backlog → Done/);
    vi.advanceTimersByTime(2000);
    await flush();
    const before = vault.files.get(p)!;
    const edited = before + "- 2026-11-21 11:00 · @someone did a thing\n";
    vault.external(p, edited);
    await flush();
    vi.advanceTimersByTime(600);
    await flush();
    vi.advanceTimersByTime(2000);
    await flush();
    expect(vault.files.get(p)).toBe(edited);
  });

  it("skips malformed files, lists them, and recovers", async () => {
    const { store, vault } = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vault.files.set("Tickets/Issues/TIX-9.md", "no frontmatter here");
    vault.files.set("Tickets/Issues/nested/x.md", "---\ntitle: x\n---\n");
    vault.files.set("Other/y.md", "---\ntitle: y\n---\n");
    await store.start();
    expect(store.getIssues()).toHaveLength(0);
    expect(store.getMalformed().map((m) => m.path)).toEqual(["Tickets/Issues/TIX-9.md"]);
    expect(warn).toHaveBeenCalled();
    vault.external("Tickets/Issues/TIX-9.md", "---\ntitle: fixed\n---\n");
    await flush();
    expect(store.getMalformed()).toHaveLength(0);
    expect(store.getIssue("TIX-9")?.title).toBe("fixed");
    warn.mockRestore();
  });

  it("handles rename, comments, children and projects", async () => {
    const { store, vault } = setup();
    await store.start();
    await store.createIssue({ title: "P" });
    await store.createIssue({ title: "C", parent: "TIX-1" });
    expect(store.childrenOf("TIX-1").map((i) => i.id)).toEqual(["TIX-2"]);
    await store.addComment("TIX-1", "hello", "claude");
    expect(vault.files.get("Tickets/Issues/TIX-1.md")).toMatch(/### @claude · .*\nhello/);
    await store.updateDescription("TIX-1", "New **desc**\n");
    const t1 = vault.files.get("Tickets/Issues/TIX-1.md")!;
    expect(t1).toMatch(/\nNew \*\*desc\*\*\n\n## Activity/);
    expect(store.getIssue("TIX-1")!.description).toBe("New **desc**");
    expect(t1).toMatch(/### @claude · .*\nhello/);
    const proj = await store.createProject({ name: "Proj" });
    expect(proj.name).toBe("Proj");
    await store.updateProject("Proj", { status: "started" });
    expect(store.getProject("Proj")!.status).toBe("started");
    const old = "Tickets/Issues/TIX-2.md";
    vault.files.set("Elsewhere/TIX-2.md", vault.files.get(old)!);
    vault.files.delete(old);
    vault.fire("rename", { path: "Elsewhere/TIX-2.md", name: "TIX-2.md", stat: {} }, old);
    await flush();
    expect(store.getIssues().map((i) => i.id)).toEqual(["TIX-1"]);
  });

  it("renames a project and rewrites issue links; deletes a project and clears them", async () => {
    const { store, vault } = setup();
    await store.start();
    await store.createProject({ name: "Website", status: "started" });
    const a = await store.createIssue({ title: "A", project: "Website" });
    await store.createIssue({ title: "B" });
    await expect(store.createProject({ name: "website" })).rejects.toThrow(/already exists/);
    await expect(store.createProject({ name: "a/b" })).rejects.toThrow();
    expect(await store.renameProject("Website", "Web")).toBe(1);
    await flush();
    expect(vault.files.has("Tickets/Projects/Website.md")).toBe(false);
    expect(store.getProject("Web")?.status).toBe("started");
    expect(store.getProject("Website")).toBeUndefined();
    expect(store.getIssue(a.id)!.project).toBe("[[Web]]");
    expect(vault.files.get(store.pathOf(a.id)!)).toContain("[[Web]]");
    expect(await store.deleteProject("Web")).toBe(1);
    await flush();
    expect(store.getProject("Web")).toBeUndefined();
    expect(store.getIssue(a.id)!.project).toBeUndefined();
    expect(vault.files.get(store.pathOf(a.id)!)).toMatch(/project/i);
  });

  it("manages milestones: add, update, reorder, rename (bulk), delete (clears issues)", async () => {
    const { store, vault } = setup();
    await store.start();
    await store.createProject({ name: "Web", status: "started" });
    await store.createProject({ name: "Other", status: "started" });
    await store.addMilestone("Web", { name: "Alpha", target: "2026-12-01" });
    await store.addMilestone("Web", { name: "Beta" });
    await expect(store.addMilestone("Web", { name: "alpha" })).rejects.toThrow(/already exists/);
    await store.updateMilestone("Web", "Beta", { description: "Later", target: "2027-01-01" });
    await store.reorderMilestones("Web", ["Beta", "Alpha"]);
    expect(store.getProject("Web")!.milestones).toEqual([
      { name: "Beta", target: "2027-01-01", description: "Later" },
      { name: "Alpha", target: "2026-12-01" },
    ]);
    const a = await store.createIssue({ title: "A", project: "Web", milestone: "Alpha" });
    await store.createIssue({ title: "B", project: "Web", milestone: "Alpha" });
    expect(await store.renameMilestone("Web", "Alpha", "Alpha 1")).toBe(2);
    await flush();
    expect(store.getIssue(a.id)!.milestone).toBe("Alpha 1");
    expect(store.getProject("Web")!.milestones.map((m) => m.name)).toEqual(["Beta", "Alpha 1"]);
    // Moving to a project without that milestone clears it, with an activity event.
    await store.updateIssue(a.id, { project: "Other" });
    await flush();
    expect(store.getIssue(a.id)!.milestone).toBeUndefined();
    expect(vault.files.get(store.pathOf(a.id)!)).toMatch(/milestone/i);
    expect(await store.deleteMilestone("Web", "Alpha 1")).toBe(1);
    await flush();
    expect(store.getProject("Web")!.milestones.map((m) => m.name)).toEqual(["Beta"]);
    expect(store.getIssues().find((i) => i.title === "B")!.milestone).toBeUndefined();
  });

  it("notifies subscribers with stable snapshots", async () => {
    const { store } = setup();
    await store.start();
    const cb = vi.fn();
    const off = store.on("change", cb);
    const s1 = store.getIssues();
    expect(store.getIssues()).toBe(s1);
    await store.createIssue({ title: "x" });
    expect(cb).toHaveBeenCalled();
    expect(store.getIssues()).not.toBe(s1);
    off();
  });
});
