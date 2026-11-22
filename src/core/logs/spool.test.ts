import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSpoolSince, spoolDays } from "./spool";

describe("spoolDays", () => {
  it("lists UTC days from since's day through now's day", () => {
    expect(spoolDays("2026-02-27T23:30:00.000Z", new Date("2026-03-01T01:00:00.000Z"))).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
    expect(spoolDays("2026-03-01T10:00:00.000Z", new Date("2026-03-01T11:00:00.000Z"))).toEqual(["2026-03-01"]);
  });
});

describe("readSpoolSince", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kh-spool-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("keeps records at or after since and skips torn lines and missing days", () => {
    fs.writeFileSync(
      path.join(dir, "2026-03-01.jsonl"),
      [
        JSON.stringify({ t: "2026-03-01T09:00:00.000Z", kind: "old" }),
        JSON.stringify({ t: "2026-03-01T10:00:00.000Z", kind: "keep" }),
        "{not json",
        "",
      ].join("\n"),
    );
    const out = readSpoolSince(dir, "2026-03-01T09:30:00.000Z", new Date("2026-03-01T11:00:00.000Z"));
    expect(out.map((r) => r.kind)).toEqual(["keep"]);
  });

  it("returns nothing when the folder does not exist", () => {
    expect(readSpoolSince(path.join(dir, "missing"), "2026-03-01T00:00:00.000Z", new Date("2026-03-01T01:00:00.000Z"))).toEqual([]);
  });
});
