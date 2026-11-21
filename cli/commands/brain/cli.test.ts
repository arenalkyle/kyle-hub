import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Io } from "../tickets/cli";
import { runBrainCheck, runLintDocs, type HubDataView } from "./cli";

let root: string;
let vault: string;
let out: string[];
const io = (env: Record<string, string> = {}): Io => ({ cwd: root, env, stdin: () => "", out: (s) => out.push(s), err: () => {}, now: () => new Date(2026, 10, 21, 10) });
const write = (base: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
  fs.writeFileSync(path.join(base, rel), text, "utf8");
};
const data = (over: Partial<HubDataView> = {}): HubDataView => ({ repos: { kh: { path: root } }, ignoreSymbols: {}, autoFindings: false, vault, ...over });
const OK_ADR = "---\ndoctype: adr\naudience: human\nreviewed: 2026-11-01\n---\n# Use X\n\nContext.\n";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "kh-brain-cli-"));
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "kh-brain-vault-"));
  out = [];
  write(root, "docs/adr/0001-ok.md", OK_ADR);
  write(root, "STATUS.md", "# STATUS\n\nno date here\n");
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(vault, { recursive: true, force: true });
});

describe("kh lint docs", () => {
  it("exits 1 on a missing last-updated line in STATUS.md, 0 once fixed", () => {
    expect(runLintDocs(["--repo", "kh"], io(), data())).toBe(1);
    expect(out.join("\n")).toMatch(/\[error\] kh: STATUS.md: missing last-updated date/);
    out = [];
    write(root, "STATUS.md", "# STATUS\n\n_Last updated: 2026-11-20_\n\n## Done\n- a\n\n## In progress\n- b\n\n## Next\n- c\n");
    expect(runLintDocs(["--repo", "kh"], io(), data())).toBe(0);
  });

  it("--vault lints Brain/ and errors on a file with no frontmatter", () => {
    write(vault, "Brain/lesson/bare.md", "# Bare\n\n## Lesson\nx\n");
    expect(runLintDocs(["--vault"], io(), data())).toBe(1);
    expect(out.join("\n")).toMatch(/Brain\/lesson\/bare.md: missing frontmatter/);
  });
});

describe("kh brain check", () => {
  it("prints findings as JSON and files none without --tickets", async () => {
    write(root, "docs/PLAN.md", "# Plan\n\nSee `src/nope.ts`.\n");
    expect(await runBrainCheck(["--repo", "kh", "--json"], io(), data())).toBe(0);
    const report = JSON.parse(out.join("")) as { findings: { check: string }[] }[];
    expect(report[0]!.findings.map((f) => f.check)).toContain("dead-path");
  });

  it("--tickets files one finding per check+doc, deduped on a second run", async () => {
    const tickets = path.join(root, "Tickets");
    fs.mkdirSync(path.join(tickets, "Issues"), { recursive: true });
    fs.mkdirSync(path.join(tickets, "Projects"));
    fs.writeFileSync(path.join(tickets, ".kyle-tickets.json"), JSON.stringify({ prefix: "TIX", version: 1 }));
    write(root, "docs/PLAN.md", "# Plan\n\nSee `src/nope.ts` and `src/gone.ts`.\n");
    const args = ["--repo", "kh", "--tickets", "--dir", tickets];
    expect(await runBrainCheck(args, io({ KH_RUN: "" }), data())).toBe(0);
    const files = fs.readdirSync(path.join(tickets, "Issues"));
    expect(files).toHaveLength(1);
    const text = fs.readFileSync(path.join(tickets, "Issues", files[0]!), "utf8");
    expect(text).toContain("brain:dead-path:docs/PLAN.md");
    expect(text).toContain("agent:brain");
    out = [];
    await runBrainCheck(args, io(), data());
    expect(fs.readdirSync(path.join(tickets, "Issues"))).toHaveLength(1);
  });
});
