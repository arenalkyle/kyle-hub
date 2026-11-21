import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPack } from "../domain/pack";
import { applyDocBudget, glossaryEntries, linkedDocPaths, parsePackInclude, adrTitle, type DocCandidate } from "../domain/packDocs";
import { selectBrainDocs, termInText } from "./selectDocs";

let root: string;
const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text, "utf8");
};
const BIG = 100_000;
const select = (ticket: { title: string; description: string }, project?: { description: string }, budgetChars = BIG) =>
  selectBrainDocs({ root, ticket, project, budgetChars });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "kh-select-"));
  write("docs/PLAN.md", "# Plan\n\nThe plan.\n");
  write("docs/adr/0007-rule-based-retrieval.md", "# Rule-based retrieval\n\nNo embeddings.\n");
  write("docs/runbooks/release.md", "# Release\n\nRun the release.\n");
  write("docs/extra.md", "# Extra\n\nIncluded by the list.\n");
  write("GLOSSARY.md", "# Glossary\n\n**Context pack**:\nThe file assembled for a run.\n\n**Brain**:\nThe module that holds the docs system.\n");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("selection rules (golden packs)", () => {
  it("rule 1a: doc linked from the ticket", () => {
    const ticket = { title: "Wire pack", description: "Read [the plan](docs/PLAN.md) first." };
    const docs = select(ticket);
    expect(docs.map((d) => [d.path, d.reason])).toEqual([["docs/PLAN.md", "linked from ticket"]]);
    expect(buildPack({ runId: "r1", ticket: { id: "LOCK-1", ...ticket }, repo: "kh", docs })).toMatchFileSnapshot("./__golden__/linked-ticket.md");
  });

  it("rule 1b: doc linked from the project", () => {
    const ticket = { title: "Wire pack", description: "No links here." };
    const docs = select(ticket, { description: "Context: docs/runbooks/release.md" });
    expect(docs.map((d) => [d.path, d.reason])).toEqual([["docs/runbooks/release.md", "linked from project"]]);
    expect(buildPack({ runId: "r1", ticket: { id: "LOCK-1", ...ticket }, repo: "kh", docs })).toMatchFileSnapshot("./__golden__/linked-project.md");
  });

  it("rule 2: .kh/pack-include.txt", () => {
    write(".kh/pack-include.txt", "# proposals\ndocs/extra.md\n\nmissing.md\n");
    const ticket = { title: "Unrelated", description: "Nothing." };
    const docs = select(ticket);
    expect(docs.map((d) => [d.path, d.reason])).toEqual([["docs/extra.md", "listed in .kh/pack-include.txt"]]);
    expect(buildPack({ runId: "r1", ticket: { id: "LOCK-1", ...ticket }, repo: "kh", docs })).toMatchFileSnapshot("./__golden__/pack-include.md");
  });

  it("rule 3: ADR title and glossary term found in the ticket text", () => {
    const ticket = { title: "Context pack retrieval", description: "Keep it rule-based retrieval only." };
    const docs = select(ticket);
    expect(docs.map((d) => d.reason)).toEqual([
      'ADR title "Rule-based retrieval" appears in ticket text',
      'glossary term "Context pack" appears in ticket text',
    ]);
    expect(docs[1]!.text).toBe("**Context pack**:\nThe file assembled for a run.");
    expect(buildPack({ runId: "r1", ticket: { id: "LOCK-1", ...ticket }, repo: "kh", docs })).toMatchFileSnapshot("./__golden__/adr-glossary.md");
  });

  it("priority: a doc linked from the ticket is not repeated by a later rule", () => {
    const docs = select({ title: "Rule-based retrieval", description: "See docs/adr/0007-rule-based-retrieval.md" });
    expect(docs.map((d) => d.reason)).toEqual(["linked from ticket"]);
  });

  it("brain off: the pack has no docs section and is ticket plus footer", () => {
    const pack = buildPack({ runId: "r1", ticket: { id: "LOCK-1", title: "T", description: "Read docs/PLAN.md." }, repo: "kh" });
    expect(pack).not.toContain("## Docs included");
    expect(pack).toMatchFileSnapshot("./__golden__/brain-off.md");
  });

  it("brain on with nothing selected lists none", () => {
    const pack = buildPack({ runId: "r1", ticket: { id: "LOCK-1", title: "T", description: "" }, repo: "kh", docs: [] });
    expect(pack).toContain("## Docs included\n\n(none selected)");
  });
});

describe("budget and parsing", () => {
  const cand = (path: string, priority: DocCandidate["priority"], len: number): DocCandidate => ({ path, reason: "r", text: "x".repeat(len), priority });

  it("drops the lowest priority first and keeps priority order", () => {
    const out = applyDocBudget([cand("low", 3, 40), cand("high", 1, 60), cand("mid", 2, 30)], 100);
    expect(out.map((d) => d.path)).toEqual(["high", "mid"]);
  });

  it("truncates the overflowing doc to what is left and drops everything after", () => {
    const out = applyDocBudget([cand("a", 1, 50), cand("b", 1, 200), cand("c", 2, 5)], 120);
    expect(out.map((d) => d.path)).toEqual(["a", "b"]);
    expect(out[1]!.text.endsWith("[truncated]")).toBe(true);
    expect(out[1]!.text.length).toBeLessThanOrEqual(70);
  });

  it("parses pack-include, link paths, ADR titles and glossary entries", () => {
    expect(parsePackInclude("# c\r\n a.md \r\n\r\n")).toEqual(["a.md"]);
    expect(linkedDocPaths("[x](docs/a.md) `b/c.md` ../evil.md /abs.md dup docs/a.md")).toEqual(["docs/a.md", "b/c.md"]);
    expect(adrTitle("# Use X\n\nbody")).toBe("Use X");
    expect(glossaryEntries("**A**:\nfirst\n_Avoid_: y\n\n**B**:\nsecond\n").map((e) => e.term)).toEqual(["A", "B"]);
  });

  it("term match falls back to Node when ripgrep is off", () => {
    expect(termInText("Context PACK here", "context pack", false)).toBe(true);
    expect(termInText("nothing", "context pack", false)).toBe(false);
    expect(termInText("Context pack", "context pack", true)).toBe(true);
  });
});
