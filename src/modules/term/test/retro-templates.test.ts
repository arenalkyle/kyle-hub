import { describe, expect, it } from "vitest";
import { applyPatch, parsePatch } from "diff";
import { renderTemplate, addedLines, MAX_SCRIPT_LINES, type TemplateContext } from "../retro/templates";
import { permissionRule, withAllowRule } from "../retro/templates/permission";
import { parseDiff, parseSignature, parseTarget, withDiff } from "../retro/ticketMeta";
import type { Cluster } from "../retro/types";

const files = new Map<string, string>();
const ctx: TemplateContext = {
  claudeHome: "/home/u/.claude",
  repoPath: (k) => (k === "kyle" ? "/work/kyle" : undefined),
  readFile: (p) => files.get(p.replace(/\\/g, "/")),
};

const cl = (kind: Cluster["kind"], signature: string, extra: Partial<Cluster> = {}): Cluster => ({
  kind,
  signature,
  count: 4,
  sessions: ["s1", "s2", "s3"],
  runIds: ["r-1", "r-2"],
  firstSeen: "2026-11-01T10:00:00Z",
  lastSeen: "2026-11-05T10:00:00Z",
  ...extra,
});

describe("templates (golden)", () => {
  it("permission_denied, cross-repo -> global settings.json diff", () => {
    files.set("/home/u/.claude/settings.json", '{\n  "permissions": {\n    "allow": [\n      "Read"\n    ]\n  }\n}\n');
    const r = renderTemplate(cl("permission_denied", "perm:Bash:rm <path>"), ctx);
    expect(r.type).toBe("proposal");
    expect(r.title).toBe("Allow Bash(rm *) without prompting");
    expect(r.body).toContain("Target: /home/u/.claude");
    expect(r.body).toContain("Signature: `perm:Bash:rm <path>`");
    expect(r.body).toContain("`kh logs show r-1`");
    expect(r.diff).toBe(
      [
        "--- a/settings.json",
        "+++ b/settings.json",
        "@@ -1,7 +1,8 @@",
        " {",
        '   "permissions": {',
        '     "allow": [',
        '-      "Read"',
        '+      "Read",',
        '+      "Bash(rm *)"',
        "     ]",
        "   }",
        " }",
        "",
      ].join("\n"),
    );
  });

  it("permission_denied, single repo -> that repo's .claude/settings.json", () => {
    files.delete("/work/kyle/.claude/settings.json");
    const r = renderTemplate(cl("permission_denied", "perm:Bash:npm test", { repo: "kyle" }), ctx);
    expect(r.body).toContain("Target: /work/kyle");
    expect(r.diff).toContain("--- /dev/null\n+++ b/.claude/settings.json");
    expect(r.diff).toContain('+      "Bash(npm test)"');
  });

  it("permission rule from signature", () => {
    expect(permissionRule("perm:Read:Read")).toBe("Read");
    expect(permissionRule("perm:Bash:cp <path> <path>")).toBe("Bash(cp *)");
    expect(withAllowRule('{"permissions":{"allow":["X"]}}', "X")).toBeUndefined();
    expect(withAllowRule("{ nope", "X")).toBeUndefined();
  });

  it("command_sequence -> script plus CLAUDE.md line, within budgets", () => {
    files.set("/home/u/.claude/CLAUDE.md", "# Rules\n");
    const r = renderTemplate(cl("command_sequence", "seq:git add <path>|git commit -m <num>|git push"), ctx);
    expect(r.type).toBe("proposal");
    expect(r.title).toBe("Script for repeated sequence: git then git then git");
    const patches = parsePatch(r.diff!);
    expect(patches).toHaveLength(2);
    expect(patches[0]!.newFileName).toMatch(/^b\/scripts\/git-git-git-[0-9a-f]{4}\.ps1$/);
    const script = addedLines(r.diff!.split("--- a/CLAUDE.md")[0]!);
    expect(script.join("\n")).toContain("git add $args[0]");
    expect(script.join("\n")).toContain("git commit -m $args[1]");
    expect(script.length).toBeLessThanOrEqual(MAX_SCRIPT_LINES);
    const ruleDiff = `--- a/CLAUDE.md${r.diff!.split("--- a/CLAUDE.md")[1]}`;
    expect(addedLines(ruleDiff)).toHaveLength(1);
    expect(addedLines(ruleDiff)[0]).toMatch(/^Use `scripts\/git-git-git-[0-9a-f]{4}\.ps1` for git then git then git\.$/);
    expect(applyPatch("# Rules\n", patches[1]!)).toContain("Use `scripts/");
  });

  it("script stays <= 40 lines for the longest window", () => {
    const sig = `seq:${Array.from({ length: 5 }, (_, i) => `tool${i} <path>`).join("|")}`;
    const r = renderTemplate(cl("command_sequence", sig), ctx);
    expect(addedLines(r.diff!.split("--- a/CLAUDE.md")[0]!).length).toBeLessThanOrEqual(MAX_SCRIPT_LINES);
  });

  it("startup_docs -> pack-include diff for the repo; finding without a mapped repo", () => {
    files.set("/work/kyle/.kh/pack-include.txt", "docs/PLAN.md\n");
    const r = renderTemplate(cl("startup_docs", "doc:kyle:docs/ARCH.md", { repo: "kyle" }), ctx);
    expect(r.type).toBe("proposal");
    expect(r.diff).toBe("--- a/.kh/pack-include.txt\n+++ b/.kh/pack-include.txt\n@@ -1,1 +1,2 @@\n docs/PLAN.md\n+docs/ARCH.md\n");
    const none = renderTemplate(cl("startup_docs", "doc:other:docs/ARCH.md", { repo: "other" }), ctx);
    expect(none.type).toBe("finding");
    expect(none.diff).toBeUndefined();
  });

  it("repeated_error, outlier, user_correction -> findings without a diff", () => {
    const e = renderTemplate(cl("repeated_error", "err:Bash:ENOENT <path>"), ctx);
    expect([e.type, e.title, e.diff]).toEqual(["finding", "Repeated error in Bash: ENOENT <path>", undefined]);
    expect(e.body).toContain("Seen 4x across 3 sessions (2026-11-01 to 2026-11-05)");
    const o = renderTemplate(cl("outlier", "out:bug:cost"), ctx);
    expect([o.type, o.title, o.diff]).toEqual(["finding", "Outlier cost for bug tickets", undefined]);
    const c = renderTemplate(cl("user_correction", "corr:Bash:git push"), ctx);
    expect([c.type, c.title]).toEqual(["finding", "Repeated correction after Bash: git push"]);
  });

  it("evidence links at most 10 runs", () => {
    const r = renderTemplate(cl("repeated_error", "err:Bash:x", { runIds: Array.from({ length: 14 }, (_, i) => `r-${i}`) }), ctx);
    expect(r.body.match(/kh logs show/g)).toHaveLength(10);
  });

  it("ticket body round-trips target, diff and signature", () => {
    const r = renderTemplate(cl("permission_denied", "perm:Bash:rm <path>"), ctx);
    const body = withDiff(r.body, r.diff);
    expect(parseTarget(body)).toBe("/home/u/.claude");
    expect(parseSignature(body)).toBe("perm:Bash:rm <path>");
    expect(parseDiff(body)).toBe(r.diff);
  });
});
