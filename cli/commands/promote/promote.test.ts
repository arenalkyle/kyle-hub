import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runKh } from "../../kh";
import type { Io } from "../tickets/cli";

let tmp: string;
let out: string[];
let errs: string[];
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kh-promote-"));
  out = [];
  errs = [];
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const io = (): Io => ({ cwd: tmp, env: { LOCALAPPDATA: path.join(tmp, "local") }, stdin: () => "", out: (s) => out.push(s), err: (s) => errs.push(s), now: () => new Date() });
const LESSON = "---\ntype: lesson\n---\nEdit C:/Work/thing/a.ts via https://wiki.corp.local/x and mail a@b.io\n";

const tree = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String) : []);

describe("kh promote", () => {
  it("--dry-run prints the diff and writes nothing", async () => {
    const src = path.join(tmp, "lesson.md");
    fs.writeFileSync(src, LESSON);
    const home = path.join(tmp, "home-vault");
    fs.mkdirSync(home);
    expect(await runKh(["promote", src, "--to", home, "--dry-run"], io())).toBe(0);
    expect(out.join("\n")).toContain("+Edit <path> via <url> and mail <email>");
    expect(out.join("\n")).toContain("nothing written");
    expect(tree(home)).toEqual([]);
    expect(fs.readFileSync(src, "utf8")).toBe(LESSON);
  });

  it("writes the scrubbed lesson to Brain/lessons and refuses to overwrite", async () => {
    const src = path.join(tmp, "lesson.md");
    fs.writeFileSync(src, LESSON);
    const home = path.join(tmp, "home-vault");
    expect(await runKh(["promote", src, "--to", home], io())).toBe(0);
    const dest = path.join(home, "Brain", "lessons", "lesson.md");
    expect(fs.readFileSync(dest, "utf8")).toContain("Edit <path> via <url> and mail <email>");
    expect(await runKh(["promote", src, "--to", home], io())).not.toBe(0);
  });

  it("rejects non-lesson files and bad usage", async () => {
    const src = path.join(tmp, "adr.md");
    fs.writeFileSync(src, "---\ntype: adr\n---\nx\n");
    expect(await runKh(["promote", src, "--to", path.join(tmp, "h")], io())).not.toBe(0);
    expect(await runKh(["promote", src], io())).not.toBe(0);
    expect(tree(path.join(tmp, "h"))).toEqual([]);
  });
});
