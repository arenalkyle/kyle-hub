import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { draftStatus } from "../../../src/core/brain/statusDraft";
import { KtError, type Io } from "../tickets/cli";
import type { HubDataView } from "./cli";
import { runStatusDraft } from "./status";

let root: string;
let out: string[];
const git = (args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: root, stdio: "ignore" });
const io = (): Io => ({ cwd: root, env: {}, stdin: () => "", out: (s) => out.push(s), err: () => {}, now: () => new Date(2026, 10, 21, 10) });
const data = (): HubDataView => ({ repos: { kh: { path: root } }, ignoreSymbols: {}, autoFindings: false });
const OK_STATUS = "# STATUS\n\n_Last updated: 2026-11-20_\n\n## Done\n- a\n\n## In progress\n- b\n\n## Next\n- c\n";
const listing = (dir: string): string[] => fs.readdirSync(dir, { recursive: true }).map(String).sort();

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "kh-status-"));
  out = [];
  fs.writeFileSync(path.join(root, "STATUS.md"), OK_STATUS, "utf8");
  git(["init", "-q"]);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "docs: status"]);
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;\n", "utf8");
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "feat: add a"]);
  fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 2;\n", "utf8");
  git(["commit", "-qam", "fix: bump a"]);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("kh status draft", () => {
  it("prints a skeleton from git log since the last STATUS commit and writes nothing", () => {
    const before = fs.readFileSync(path.join(root, "STATUS.md"), "utf8");
    const files = listing(root);
    expect(runStatusDraft(["--repo", "kh"], io(), data())).toBe(0);
    const text = out.join("\n");
    expect(text).toMatchFileSnapshot("./__golden__/status-draft.md");
    expect(text).toContain("- feat: add a");
    expect(text).not.toContain("docs: status");
    expect(text).toContain("_Last updated: 2026-11-21_");
    expect(fs.readFileSync(path.join(root, "STATUS.md"), "utf8")).toBe(before);
    expect(listing(root)).toEqual(files);
  });

  it("includes the last test result when .kh/last-test.json exists", () => {
    fs.mkdirSync(path.join(root, ".kh"));
    fs.writeFileSync(path.join(root, ".kh", "last-test.json"), JSON.stringify({ at: "2026-11-21T09:00:00Z", passed: 12, failed: 1, command: "npm test" }), "utf8");
    runStatusDraft(["--repo", "kh"], io(), data());
    expect(out.join("\n")).toContain("_Last test: 12 passed, 1 failed (2026-11-21T09:00:00Z), `npm test`_");
  });

  it("rejects a missing or unknown repo key", () => {
    expect(() => runStatusDraft([], io(), data())).toThrow(KtError);
    expect(() => runStatusDraft(["--repo", "nope"], io(), data())).toThrow(/unknown repo/);
  });
});

describe("draftStatus", () => {
  it("routes tickets by status and caps the Next list", () => {
    const text = draftStatus({
      date: "2026-11-21",
      commits: ["feat: x"],
      tickets: [
        { id: "K-1", title: "Done one", status: "Done" },
        { id: "K-2", title: "Running", status: "In Review" },
        { id: "K-3", title: "Dropped", status: "Canceled" },
        ...Array.from({ length: 12 }, (_, i) => ({ id: `K-${10 + i}`, title: `Todo ${i}`, status: "Backlog" })),
      ],
    });
    expect(text).toContain("- K-1: Done one");
    expect(text).toContain("- K-2: Running (In Review)");
    expect(text).not.toContain("K-3");
    expect(text.match(/- K-1\d: Todo/g)?.length).toBe(10);
    expect(text).toContain("_Last test: none recorded_");
  });
});
