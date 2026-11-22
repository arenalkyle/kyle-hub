import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RETENTION, sweepProfile } from "./retention";

const NOW = new Date("2026-11-22T12:00:00.000Z");
const DAY_MS = 86_400_000;
let root: string;
let env: { LOCALAPPDATA?: string; USERPROFILE?: string };

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "kh-retention-"));
  env = { LOCALAPPDATA: process.env.LOCALAPPDATA, USERPROFILE: process.env.USERPROFILE };
  process.env.LOCALAPPDATA = path.join(root, "localappdata");
  process.env.USERPROFILE = path.join(root, "userprofile");
});

afterEach(() => {
  process.env.LOCALAPPDATA = env.LOCALAPPDATA;
  process.env.USERPROFILE = env.USERPROFILE;
  fs.rmSync(root, { recursive: true, force: true });
});

function writeAged(file: string, ageDays: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"type":"human_open"}\n');
  const t = (NOW.getTime() - ageDays * DAY_MS) / 1000;
  fs.utimesSync(file, t, t);
}

describe("sweepProfile human spool", () => {
  it("sweeps human_open files past retentionDays and keeps recent ones", () => {
    const dir = path.join(root, "profile");
    const old = path.join(dir, "human", "old.jsonl");
    const recent = path.join(dir, "human", "recent.jsonl");
    writeAged(old, DEFAULT_RETENTION.retentionDays + 1);
    writeAged(recent, 3);

    const dry = sweepProfile(dir, NOW, DEFAULT_RETENTION, true, {});
    expect(dry.items).toEqual([{ kind: "spool", path: old, detail: "human_open" }]);
    expect(fs.existsSync(old)).toBe(true);

    const res = sweepProfile(dir, NOW, DEFAULT_RETENTION, false, {});
    expect(res.items).toEqual([{ kind: "spool", path: old, detail: "human_open" }]);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(recent)).toBe(true);
  });

  it("uses retentionDays, not spoolDays, for human files", () => {
    const dir = path.join(root, "profile");
    const file = path.join(dir, "human", "day-40.jsonl");
    writeAged(file, 40);
    const res = sweepProfile(dir, NOW, { ...DEFAULT_RETENTION, retentionDays: 90, spoolDays: 7 }, false, {});
    expect(res.items).toEqual([]);
    expect(fs.existsSync(file)).toBe(true);
  });
});
