import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBrainService, type HealthChangedPayload } from "./service";
import { DEFAULT_HEALTH_WEIGHTS, healthScore, sumCounts } from "./health";

const OK_STATUS = "# STATUS\n\n_Last updated: 2026-11-20_\n\n## Done\n- a\n\n## In progress\n- b\n\n## Next\n- c\n";
const BAD_STATUS = "# STATUS\n\nno date here\n";
let root: string;
let vault: string;
const write = (base: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
  fs.writeFileSync(path.join(base, rel), text, "utf8");
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "kh-health-"));
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "kh-health-vault-"));
  write(root, "docs/adr/0001-ok.md", "---\ndoctype: adr\naudience: human\nreviewed: 2026-11-01\n---\n# Use X\n\nContext.\n");
  write(root, "STATUS.md", BAD_STATUS);
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(vault, { recursive: true, force: true });
});

describe("healthScore", () => {
  it("applies the default weights and clamps at zero", () => {
    expect(healthScore({ lintErrors: 1, lintWarnings: 2, stalenessIssues: 3 })).toBe(100 - 5 - 2 - 6);
    expect(healthScore({ lintErrors: 30, lintWarnings: 0, stalenessIssues: 0 })).toBe(0);
    expect(DEFAULT_HEALTH_WEIGHTS).toEqual({ lintError: 5, lintWarning: 1, stalenessIssue: 2 });
  });

  it("honours custom weights and sums counts for the vault", () => {
    expect(healthScore({ lintErrors: 2, lintWarnings: 4, stalenessIssues: 1 }, { lintError: 10, lintWarning: 0, stalenessIssue: 1 })).toBe(79);
    expect(sumCounts([{ lintErrors: 1, lintWarnings: 0, stalenessIssues: 2 }, { lintErrors: 0, lintWarnings: 3, stalenessIssues: 0 }])).toEqual({ lintErrors: 1, lintWarnings: 3, stalenessIssues: 2 });
  });
});

describe("BrainService health", () => {
  const make = () => {
    const events: HealthChangedPayload[] = [];
    const svc = createBrainService({
      repos: () => ({ kh: { path: root } }),
      ignoreSymbols: () => [],
      vaultBrainDir: () => path.join(vault, "Brain"),
      emit: (p) => events.push(p),
    });
    return { svc, events };
  };

  it("emits brain:health-changed only when a score changes", () => {
    const { svc, events } = make();
    svc.refreshHealth();
    expect(svc.health().repos.kh).toMatchObject({ score: 79, lintErrors: 4, lintWarnings: 1 });
    expect(events).toContainEqual({ scope: "repo", key: "kh", score: 79 });
    const before = events.length;
    svc.refreshHealth();
    expect(events.length).toBe(before);
    write(root, "STATUS.md", OK_STATUS);
    svc.check("kh");
    const after = svc.health().repos.kh!.score;
    expect(after).toBeGreaterThan(79);
    expect(events.slice(before)).toEqual([
      { scope: "vault", key: "vault", score: after, previous: 79 },
      { scope: "repo", key: "kh", score: after, previous: 79 },
    ]);
  });

  it("counts the vault Brain/ folder in the vault score", () => {
    write(vault, "Brain/lessons/no-frontmatter.md", "# Lesson\n");
    const { svc } = make();
    svc.refreshHealth();
    expect(svc.health().vault.lintErrors + svc.health().vault.lintWarnings).toBeGreaterThan(0);
    expect(svc.health().vault.score).toBeLessThan(100);
  });

  it("with a nested brain folder, only that folder counts (siblings like docs/adr are ignored) and inventory matches", () => {
    write(vault, "docs/adr/0001-unrelated.md", "# no frontmatter\n");
    write(vault, "docs/plugins/zones.md", "# no frontmatter\n");
    write(vault, "docs/brain/lessons/good.md", "---\ndoctype: lesson\naudience: agent\nreviewed: 2026-11-20\n---\n# Lesson\n\n## Lesson\nx\n");
    write(vault, ".kyle-hub/grading.json", JSON.stringify({ exclude: ["docs/brain/skip", "docs/brain/skip/**"] }));
    write(vault, "docs/brain/skip/bad.md", "# excluded by the vault grading.json\n");
    const svc = createBrainService({
      repos: () => ({}),
      ignoreSymbols: () => [],
      vaultBrainDir: () => path.join(vault, "docs", "brain"),
      vaultBrainRel: () => "docs/brain",
    });
    svc.refreshHealth();
    expect(svc.health().vault).toMatchObject({ lintErrors: 0, score: 100 });
    expect(svc.inventory().docs).toBe(1);
  });

  it("pointing the brain folder at a general docs/ folder would lint unrelated notes (why conventions have their own setting)", () => {
    write(vault, "docs/adr/0001-unrelated.md", "# no frontmatter\n");
    const svc = createBrainService({ repos: () => ({}), ignoreSymbols: () => [], vaultBrainDir: () => path.join(vault, "docs"), vaultBrainRel: () => "docs" });
    svc.refreshHealth();
    expect(svc.health().vault.lintErrors + svc.health().vault.lintWarnings).toBeGreaterThan(0);
  });

  it("selectDocs reads the repo and honours the token budget", () => {
    write(root, "docs/PLAN.md", "# Plan\n\n" + "x".repeat(200) + "\n");
    const { svc } = make();
    const { docs } = svc.selectDocs({ repo: "kh", title: "t", description: "see docs/PLAN.md" }, undefined, 10);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.text.length).toBeLessThanOrEqual(40);
    expect(docs[0]!.text.endsWith("[truncated]")).toBe(true);
  });
});
