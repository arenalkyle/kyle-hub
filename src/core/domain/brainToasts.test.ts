import { describe, expect, it } from "vitest";
import { startSession, startSubagent, type Agents } from "./brainAgents";
import { tagNames } from "./brainTags";
import { cutPath, ToastQueue, toastText, type ToastInput } from "./brainToasts";

const inp = (agentId: string, path: string, kind: "read" | "write" = "read"): ToastInput => ({ agentId, name: agentId, color: "#fff", kind, path });

describe("ToastQueue", () => {
  it("shows one toast and expires it after 3 s", () => {
    const q = new ToastQueue();
    q.push(inp("a", "x.md"), 0);
    expect(q.views()).toHaveLength(1);
    expect(q.tick(2999)).toBe(false);
    expect(q.tick(3000)).toBe(true);
    expect(q.views()).toHaveLength(0);
  });

  it("merges a burst of 30 reads in 1 s into one toast", () => {
    const q = new ToastQueue();
    for (let i = 0; i < 30; i++) q.push(inp("a", `n${i}.md`), i * 33);
    const v = q.views();
    expect(v).toHaveLength(1);
    expect(v[0]!.toast.reads).toBe(30);
    expect(toastText(v[0]!.toast)).toBe("a read 30 notes · ./n29.md");
  });

  it("restarts the timer on merge, within 2 s of the last activity", () => {
    const q = new ToastQueue();
    q.push(inp("a", "1.md"), 0);
    q.push(inp("a", "2.md"), 1900);
    q.tick(4000);
    expect(q.views()).toHaveLength(1);
    q.tick(4900);
    expect(q.views()).toHaveLength(0);
  });

  it("starts a fresh toast for the same agent after the merge window", () => {
    const q = new ToastQueue();
    q.push(inp("a", "1.md"), 0);
    q.hover(q.views()[0]!.toast.id, true, 100);
    q.push(inp("a", "2.md"), 2500);
    const v = q.views();
    expect(v).toHaveLength(1);
    expect(v[0]!.toast.reads).toBe(1);
    expect(toastText(v[0]!.toast)).toBe("a read ./2.md");
  });

  it("gives each agent its own toast", () => {
    const q = new ToastQueue();
    q.push(inp("a", "1.md"), 0);
    q.push(inp("b", "2.md", "write"), 10);
    expect(q.views().map((v) => toastText(v.toast))).toEqual(["a read ./1.md", "b wrote ./2.md"]);
  });

  it("says touched for mixed reads and writes", () => {
    const q = new ToastQueue();
    q.push(inp("a", "1.md"), 0);
    q.push(inp("a", "2.md", "write"), 10);
    expect(toastText(q.views()[0]!.toast)).toBe("a touched 2 notes · ./2.md");
  });

  it("pauses while hovered and resumes with the remaining life", () => {
    const q = new ToastQueue();
    q.push(inp("a", "1.md"), 0);
    const id = q.views()[0]!.toast.id;
    q.hover(id, true, 1000);
    q.tick(60_000);
    expect(q.views()).toHaveLength(1);
    q.hover(id, false, 60_000);
    q.tick(61_999);
    expect(q.views()).toHaveLength(1);
    q.tick(62_000);
    expect(q.views()).toHaveLength(0);
  });

  it("keeps a hovered toast paused when new activity merges into it", () => {
    const q = new ToastQueue();
    q.push(inp("a", "1.md"), 0);
    const id = q.views()[0]!.toast.id;
    q.hover(id, true, 500);
    q.push(inp("a", "2.md"), 1000);
    q.tick(30_000);
    expect(q.views()).toHaveLength(1);
    q.hover(id, false, 30_000);
    q.tick(33_000);
    expect(q.views()).toHaveLength(0);
  });

  it("caps at 5 plus a faded 6th and drops older ones", () => {
    const q = new ToastQueue();
    for (let i = 0; i < 8; i++) q.push(inp(`a${i}`, "x.md"), i);
    const v = q.views();
    expect(v).toHaveLength(6);
    expect(v.map((x) => x.faded)).toEqual([true, false, false, false, false, false]);
    expect(v[0]!.toast.agentId).toBe("a2");
    expect(v[5]!.toast.agentId).toBe("a7");
  });
});

describe("cutPath", () => {
  it("keeps short paths", () => expect(cutPath("a/b.md")).toBe("./a/b.md"));
  it("cuts the middle of long paths", () => expect(cutPath("docs/adr/decisions/2026/very-long-folder/readme.md", 24)).toBe("./docs/…/readme.md"));
  it("cuts a long file name in the middle", () => {
    const c = cutPath("a-really-long-file-name-for-a-note.md", 20);
    expect(c.length).toBeLessThanOrEqual(20);
    expect(c.startsWith("./")).toBe(true);
    expect(c).toContain("…");
    expect(c.endsWith(".md")).toBe(true);
  });
});

describe("tagNames", () => {
  const lookup = (title?: string, cwd = "C:\\dev\\kyle-hub") => () => ({ title, cwd, kind: "claude" as const });
  const build = (...specs: [string, string | undefined][]): Agents => {
    let a: Agents = new Map();
    for (const [id, title] of specs) a = startSession(a, id, 0, (sid) => (sid === id ? lookup(title)() : undefined));
    return a;
  };
  const both = (specs: [string, string | undefined][]): Agents => {
    const titles = new Map(specs);
    let a: Agents = new Map();
    for (const [id] of specs) a = startSession(a, id, 0, (sid) => lookup(titles.get(sid))());
    return a;
  };

  it("leaves unique titles alone", () => {
    const n = tagNames(both([["3fa111", "kyle-hub"], ["9bc222", "docs"]]));
    expect(n.get("3fa111")).toBe("kyle-hub");
    expect(n.get("9bc222")).toBe("docs");
  });

  it("adds short IDs when titles clash", () => {
    const n = tagNames(both([["3fa111", "kyle-hub"], ["9bc222", "kyle-hub"], ["1de333", "docs"]]));
    expect(n.get("3fa111")).toBe("kyle-hub · 3fa");
    expect(n.get("9bc222")).toBe("kyle-hub · 9bc");
    expect(n.get("1de333")).toBe("docs");
  });

  it("uses folder plus ID for sessions with no pane", () => {
    const n = tagNames(build(["77a999", undefined]));
    expect(n.get("77a999")).toBe("kyle-hub · 77a");
  });

  it("names moons from the parent's display name", () => {
    const titles = new Map<string, string | undefined>([["3fa111", "kyle-hub"], ["9bc222", "kyle-hub"]]);
    const lk = (sid: string) => lookup(titles.get(sid))();
    let a: Agents = startSession(new Map(), "3fa111", 0, lk);
    a = startSession(a, "9bc222", 0, lk);
    a = startSubagent(a, "3fa111", "sub1", "Explore", 0, lk);
    expect(tagNames(a).get("sub1")).toBe("kyle-hub · 3fa › Explore");
  });
});
