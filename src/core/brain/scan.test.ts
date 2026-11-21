import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkRepo, hasRipgrep, mentionsNode, mentionsRipgrep } from "./scan";
import { fileFindings, groupFindings, type FindingSink } from "./service";
import type { Finding } from "./checks";

let root: string;
const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text, "utf8");
};
const today = (): string => new Date().toISOString().slice(0, 10);
const FM = (doctype: string, reviewed: string) => `---\ndoctype: ${doctype}\naudience: agent\nreviewed: ${reviewed}\n---\n`;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "kh-brain-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function initGitWithCommit(): void {
  const g = (args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  g(["init", "-q"]);
  g(["add", "-A"]);
  g(["-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "init"]);
}

describe("scanRepo / checkRepo on a temp repo", () => {
  it("flags stale status (real git commit date), dead path and dead symbol; clean repo stays quiet", () => {
    write("src/loader.ts", "export function loadModules() {}\n");
    write("STATUS.md", "_Last updated: 2000-01-01_\n\n## Done\n- x\n\n## In progress\n- y\n\n## Next\n- z\n");
    write(
      "docs/PLAN.md",
      `# Plan\n\nSee \`src/missing.ts\`, \`loadModules\` and \`ghostWidget\`.\n`,
    );
    write("docs/adr/0001-one.md", `${FM("adr", today())}# One\n\nContext.\n`);
    initGitWithCommit();

    const res = checkRepo(root, { useRipgrep: hasRipgrep() });
    const checks = res.findings.map((f) => `${f.check}:${f.doc}`).sort();
    expect(checks).toContain("status-behind:STATUS.md");
    expect(checks).toContain("dead-path:docs/PLAN.md");
    expect(checks).toContain("dead-symbol:docs/PLAN.md");
    expect(res.findings.find((f) => f.check === "dead-symbol")?.detail).toMatch(/ghostWidget/);
    expect(res.findings.some((f) => f.check === "dead-symbol" && /loadModules/.test(f.detail))).toBe(false);
    expect(res.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("negative fixture: fresh status and existing paths produce no findings", () => {
    write("src/a.ts", "export const x = 1;\n");
    write("STATUS.md", `_Last updated: ${today()}_\n\n## Done\n- x\n\n## In progress\n- y\n\n## Next\n- z\n`);
    write("docs/PLAN.md", "# Plan\n\nSee `src/a.ts`.\n");
    initGitWithCommit();
    const res = checkRepo(root, { useRipgrep: hasRipgrep() });
    expect(res.findings).toEqual([]);
  });
});

describe("mention search: ripgrep and Node fallback agree", () => {
  beforeEach(() => {
    write("src/a.ts", "const runRetroNow = 1;\nconst Other = 2;\n");
    write("notes.md", "plain text\n");
  });

  it.skipIf(!hasRipgrep())("ripgrep finds terms and respects exclusion", () => {
    expect(mentionsRipgrep(root, "runRetroNow", { ignoreCase: false, excludePath: "notes.md" })).toBe(true);
    expect(mentionsRipgrep(root, "absentSymbol", { ignoreCase: false, excludePath: "notes.md" })).toBe(false);
    expect(mentionsRipgrep(root, "PLAIN TEXT", { ignoreCase: true, excludePath: "src/a.ts" })).toBe(true);
    expect(mentionsRipgrep(root, "plain text", { ignoreCase: false, excludePath: "notes.md" })).toBe(false);
  });

  it("Node fallback gives the same answers", () => {
    expect(mentionsNode(root, "runRetroNow", { ignoreCase: false, excludePath: "notes.md" })).toBe(true);
    expect(mentionsNode(root, "absentSymbol", { ignoreCase: false, excludePath: "notes.md" })).toBe(false);
    expect(mentionsNode(root, "PLAIN TEXT", { ignoreCase: true, excludePath: "src/a.ts" })).toBe(true);
    expect(mentionsNode(root, "plain text", { ignoreCase: false, excludePath: "notes.md" })).toBe(false);
  });
});

describe("findings filing", () => {
  const f = (doc: string, check: Finding["check"], detail: string): Finding => ({ doc, check, detail });

  it("groups findings per check+doc with the brain fingerprint", () => {
    const groups = groupFindings("kyle-hub", [f("docs/PLAN.md", "dead-path", "a"), f("docs/PLAN.md", "dead-path", "b"), f("STATUS.md", "status-behind", "c")]);
    expect(groups.map((g) => g.fingerprint)).toEqual(["brain:dead-path:docs/PLAN.md", "brain:status-behind:STATUS.md"]);
    expect(groups[0]!.description).toBe("- a\n- b");
  });

  it("files via a sink, deduped by fingerprint and stopping at the cap", async () => {
    const seen = new Map<string, string>();
    let created = 0;
    const sink: FindingSink = {
      create: async (input) => {
        const fp = input.fingerprint!;
        if (seen.has(fp)) return { id: seen.get(fp)! };
        if (created >= 2) throw new Error("Per-run cap reached");
        created++;
        const id = `TIX-${created}`;
        seen.set(fp, id);
        return { id };
      },
    };
    const findings = [f("a.md", "dead-path", "x"), f("b.md", "dead-path", "y"), f("c.md", "dead-path", "z")];
    const first = await fileFindings("kyle-hub", findings, sink);
    expect(first.filed).toEqual(["TIX-1", "TIX-2"]);
    expect(first.skipped).toHaveLength(1);
    const again = await fileFindings("kyle-hub", findings.slice(0, 1), sink);
    expect(again.filed).toEqual(["TIX-1"]);
  });
});
