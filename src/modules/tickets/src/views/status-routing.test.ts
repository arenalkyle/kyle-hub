import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

describe("Done gate routing", () => {
  it("no view writes issues through store.updateIssue directly (all go through plugin.updateIssue)", () => {
    const offenders = walk(__dirname).filter((f) => /store\.updateIssue\(/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
