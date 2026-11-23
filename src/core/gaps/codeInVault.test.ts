import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanVaultNotes } from "./gather";
import { lintVaultBrain } from "../brain/scan";
import { brainInventory } from "../brain/inventory";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const put = (root: string, rel: string, text = "x"): void => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

function vault(): string {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), "kh-code-"));
  dirs.push(v);
  put(v, ".git/HEAD");
  put(v, "Notes/a.md", "# A\n\nhello world\n");
  put(v, "Code/app/package.json", "{}");
  put(v, "Code/app/README.md", "# Readme\n");
  put(v, "Code/app/docs/guide.md", "no frontmatter\n");
  put(v, "Code/app/node_modules/x/.git/HEAD");
  put(v, "Scratch/tmp.md", "# t\n");
  return v;
}

describe("code in the vault", () => {
  it("Gaps scan finds code roots and grades no code notes", () => {
    const v = vault();
    const r = scanVaultNotes(v);
    expect(r.codeRoots).toEqual(["Code/app"]);
    expect(r.notes.map((n) => n.path).sort()).toEqual(["Notes/a.md", "Scratch/tmp.md"]);
    expect(scanVaultNotes(v, ["Scratch"]).notes.map((n) => n.path)).toEqual(["Notes/a.md"]);
  });

  it("brain lint and inventory skip code under Brain/", () => {
    const v = vault();
    put(v, "Brain/lessons/ok.md", "---\ndoctype: lesson\naudience: human\nreviewed: 2026-11-01\n---\n# L\n\n## Lesson\nText.\n");
    put(v, "Brain/repo/Cargo.toml", "");
    put(v, "Brain/repo/README.md", "bad doc, no frontmatter\n");
    put(v, "Brain/skip/bad.md", "bad doc\n");
    const dir = path.join(v, "Brain");
    const files = (xs: ReturnType<typeof lintVaultBrain>): string[] => [...new Set(xs.map((i) => i.path))];
    const base = lintVaultBrain(dir);
    expect(files(base).some((f) => f.includes("repo/"))).toBe(false);
    expect(files(base).some((f) => f.includes("skip/"))).toBe(true);
    expect(files(lintVaultBrain(dir, ["Brain/skip"])).some((f) => f.includes("skip/"))).toBe(false);
    expect(brainInventory({ repoRoots: [], repoDocs: 0, vaultBrainDir: dir }).docs).toBe(2);
    expect(brainInventory({ repoRoots: [], repoDocs: 0, vaultBrainDir: dir, vaultExclude: ["Brain/skip"] }).docs).toBe(1);
  });
});
