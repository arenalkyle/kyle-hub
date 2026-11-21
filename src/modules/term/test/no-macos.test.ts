import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../../..");
const SELF = "no-macos.test.ts";
const EXTS = new Set([".ts", ".tsx", ".js", ".mjs", ".css"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "fixtures") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXTS.has(path.extname(e.name))) out.push(p);
  }
  return out;
}

describe("Windows only (ADR-0009)", () => {
  it("no darwin / macOS branches remain in source, scripts or tests", () => {
    const files = [...walk(path.join(root, "src")), ...walk(path.join(root, "scripts")), ...walk(path.join(root, "test"))].filter(
      (f) => !f.endsWith(SELF) && !f.endsWith("kt.js"),
    );
    const hits: string[] = [];
    for (const f of files) {
      fs.readFileSync(f, "utf8").split(/\r?\n/).forEach((line, i) => {
        if (/darwin|macos|homebrew|afplay|\bzsh\b/i.test(line)) hits.push(`${path.relative(root, f)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
