import { describe, expect, it } from "vitest";
import { backtickTokens, pathTokens, runChecks, symbolTokens, type Finding, type RepoSnapshot } from "./checks";

const NOW = new Date("2026-11-21T12:00:00Z");

function snap(over: Partial<RepoSnapshot> & { files?: string[]; terms?: string[] } = {}): RepoSnapshot {
  const files = new Set(over.files ?? []);
  const terms = new Set(over.terms ?? []);
  return {
    docs: [],
    now: NOW,
    exists: (p) => files.has(p),
    mentions: (t) => terms.has(t),
    ignoreSymbols: [],
    ...over,
  };
}

const byCheck = (fs: Finding[], c: string) => fs.filter((f) => f.check === c);

describe("review-overdue", () => {
  it("flags a status reviewed 15 days ago (limit 14) and not one reviewed 13 days ago", () => {
    const over = snap({ docs: [{ path: "STATUS.md", type: "status", text: "", reviewed: "2026-11-06" }] });
    expect(byCheck(runChecks(over), "review-overdue")).toHaveLength(1);
    const ok = snap({ docs: [{ path: "STATUS.md", type: "status", text: "", reviewed: "2026-11-08" }] });
    expect(byCheck(runChecks(ok), "review-overdue")).toHaveLength(0);
  });

  it("never flags adr or glossary", () => {
    const docs = [
      { path: "docs/adr/0001-a.md", type: "adr" as const, text: "", reviewed: "2020-01-01" },
      { path: "GLOSSARY.md", type: "glossary" as const, text: "", reviewed: "2020-01-01" },
    ];
    expect(byCheck(runChecks(snap({ docs })), "review-overdue")).toHaveLength(0);
  });
});

describe("status-behind", () => {
  const text = "_Last updated: 2026-11-01_\n## Done\n## In progress\n## Next\n";
  it("flags when the last commit is more than 7 days after last-updated", () => {
    const f = runChecks(snap({ lastCommit: "2026-11-10", docs: [{ path: "STATUS.md", type: "status", text }] }));
    expect(byCheck(f, "status-behind")).toHaveLength(1);
  });
  it("passes when the gap is within 7 days", () => {
    const f = runChecks(snap({ lastCommit: "2026-11-08", docs: [{ path: "STATUS.md", type: "status", text }] }));
    expect(byCheck(f, "status-behind")).toHaveLength(0);
  });
});

describe("dead-path", () => {
  it("flags a backticked path that does not exist, and not one that does", () => {
    const text = "See `src/foo.ts` and `docs/x.md`. Ignore `src/core/` glob `src/*.ts` and `kh tickets new`.";
    const f = runChecks(snap({ files: ["docs/x.md"], docs: [{ path: "docs/PLAN.md", text }] }));
    expect(byCheck(f, "dead-path").map((x) => x.detail)).toEqual(["src/foo.ts does not exist", "src/core does not exist"]);
  });
});

describe("dead-symbol", () => {
  it("flags unknown code symbols and skips glossary terms and the ignore list", () => {
    const text = "Uses `loadModules` and `ghostThing` and `SOME_FLAG` and `KH_RUN`.";
    const glossary = { path: "GLOSSARY.md", type: "glossary" as const, text: "**KH_RUN**:\ndef" };
    const doc = { path: "docs/PLAN.md", text };
    const present = runChecks(snap({ terms: ["loadModules", "ghostThing", "SOME_FLAG", "KH_RUN"], docs: [doc, glossary] }));
    expect(byCheck(present, "dead-symbol")).toHaveLength(0);
    const missing = runChecks(snap({ terms: ["loadModules"], docs: [doc, glossary], ignoreSymbols: ["SOME_FLAG"] }));
    expect(byCheck(missing, "dead-symbol").map((x) => x.detail)).toEqual(["`ghostThing` not found in repo"]);
  });

  it("symbol heuristic is conservative", () => {
    expect(symbolTokens(["status", "abc", "loadModules", "a_b", "a_bc", "hub.services", "src/x.ts", "Hub_1"])).toEqual(["loadModules", "a_bc", "Hub_1"]);
  });
});

describe("adr-orphan", () => {
  it("flags an ADR whose referenced paths all vanished, not one with a surviving path", () => {
    const adr = { path: "docs/adr/0003-x.md", type: "adr" as const, text: "# X\n\nSee `src/gone.ts` and `src/also-gone.ts`." };
    expect(byCheck(runChecks(snap({ docs: [adr] })), "adr-orphan")).toHaveLength(1);
    expect(byCheck(runChecks(snap({ docs: [adr], files: ["src/gone.ts"] })), "adr-orphan")).toHaveLength(0);
  });
});

describe("glossary-unused", () => {
  it("flags a term not mentioned outside the glossary, case-insensitively", () => {
    const g = { path: "GLOSSARY.md", type: "glossary" as const, text: "**Brain**:\nx\n\n**Promote**:\ny" };
    const f = runChecks(snap({ docs: [g], mentions: (t, o) => (o.ignoreCase ? t.toLowerCase() === "brain" : t === "brain") }));
    const unused = byCheck(f, "glossary-unused").map((x) => x.detail);
    expect(unused).toEqual(['term "Promote" not used outside this file']);
  });
});

describe("token helpers", () => {
  it("ignores fenced code and collects backticked spans", () => {
    expect(backtickTokens("a `one`\n```\n`hidden`\n```\nb `two`")).toEqual(["one", "two"]);
  });
  it("path tokens need a slash and no wildcards, URLs or absolute paths", () => {
    expect(pathTokens(["docs/x.md", "a/*.ts", "https://x/y", "/abs/p", "C:/x/y", "../up/z", "bare.ts"])).toEqual(["docs/x.md"]);
  });
});
