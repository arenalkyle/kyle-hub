import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileLogService } from "./service";
import { dayKey } from "./runIndex";
import type { PriceTable } from "./types";

const FIXTURE = path.resolve(__dirname, "../../../test/fixtures/transcripts/session-basic.jsonl");
const PRICES: PriceTable = { "claude-test-1": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } };
const SID = "syn-session-1";
const RUN = `s-${SID}`;

let root: string;
let projects: string;
let data: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "kh-index-svc-"));
  projects = path.join(root, "claude", "projects", "proj");
  data = path.join(root, "data");
  fs.mkdirSync(projects, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function service(now: Date = new Date("2026-01-01T12:00:00.000Z")): FileLogService {
  return new FileLogService({
    dataRoot: (p) => path.join(data, p),
    projectsDir: path.join(root, "claude", "projects"),
    prices: PRICES,
    now: () => now,
  });
}

const indexFile = (p = "home") => path.join(data, p, "index.jsonl");

describe("run index via ingest", () => {
  it("adds the run on first ingest and updates it on a later ingest", async () => {
    fs.copyFileSync(FIXTURE, path.join(projects, `${SID}.jsonl`));
    const svc = service();
    await svc.ingest({ profile: "home" });
    const first = await svc.run(RUN);
    expect(first).toMatchObject({ runId: RUN, sessionId: SID, profile: "home", repo: "demo" });
    expect(first?.costUsd).toBeGreaterThan(0);

    const extra = {
      type: "assistant",
      uuid: "a9",
      sessionId: SID,
      timestamp: "2026-01-01T11:00:00.000Z",
      cwd: "C:\\work\\demo",
      message: { id: "msg_9", model: "claude-test-1", role: "assistant", content: [{ type: "text", text: "done" }], usage: { input_tokens: 1000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    };
    fs.appendFileSync(path.join(projects, `${SID}.jsonl`), `${JSON.stringify(extra)}\n`);
    await svc.ingest({ profile: "home" });
    const second = await svc.run(RUN);
    expect(second?.end).toBe("2026-01-01T11:00:00.000Z");
    expect(second?.costUsd).toBeGreaterThan(first?.costUsd ?? 0);
    expect(readAll(indexFile()).filter((e) => e.runId === RUN)).toHaveLength(1);
    expect(fs.existsSync(`${indexFile()}.tmp`)).toBe(false);
  });

  it("serves queries, records and spend from the index", async () => {
    fs.copyFileSync(FIXTURE, path.join(projects, `${SID}.jsonl`));
    const svc = service(new Date("2026-01-01T10:00:00.000Z"));
    await svc.ingest({ profile: "home" });
    const [entry] = await svc.runs({ repo: "demo" });
    expect(entry?.runId).toBe(RUN);
    expect(await svc.runs({ ticketId: "NOPE" })).toEqual([]);
    expect(await svc.countSince("2025-12-31T00:00:00.000Z")).toBe(1);
    expect(await svc.countSince("2026-01-02T00:00:00.000Z")).toBe(0);
    const spend = await svc.spendByDay(1);
    expect(spend).toEqual([{ day: dayKey(new Date(entry?.start ?? "")), costUsd: entry?.costUsd }]);
    const types: string[] = [];
    for await (const r of svc.records(RUN)) types.push(r.type);
    expect(types[0]).toBe("run");
    expect(types.length).toBeGreaterThan(5);
  });
});

describe("retention sweep", () => {
  const OLD = new Date("2026-01-01T00:00:00.000Z");

  function seed(): void {
    const runsDir = path.join(data, "home", "runs");
    fs.mkdirSync(runsDir, { recursive: true });
    fs.mkdirSync(path.join(data, "home", "packs"), { recursive: true });
    fs.mkdirSync(path.join(data, "home", "hooks"), { recursive: true });
    const run = path.join(runsDir, "s-old.jsonl");
    fs.writeFileSync(run, `${JSON.stringify({ type: "run", runId: "s-old", t: OLD.toISOString(), profile: "home" })}\n`);
    fs.utimesSync(run, OLD, OLD);
    const line = (id: string, start: string) => JSON.stringify({ runId: id, sessionId: id, profile: "home", start, durationMs: 0, costUsd: 0, toolCalls: 0, errors: 0, denials: 0 });
    fs.writeFileSync(indexFile(), `${line("s-old", OLD.toISOString())}\n${line("s-new", "2027-01-31T00:00:00.000Z")}\n`);
    const pack = path.join(data, "home", "packs", "old.md");
    fs.writeFileSync(pack, "x");
    fs.utimesSync(pack, OLD, OLD);
    const fresh = path.join(data, "home", "packs", "fresh.md");
    fs.writeFileSync(fresh, "y");
    fs.utimesSync(fresh, new Date("2027-01-31T00:00:00.000Z"), new Date("2027-01-31T00:00:00.000Z"));
    const consumed = path.join(data, "home", "hooks", "2026-01-01.jsonl");
    const pending = path.join(data, "home", "hooks", "2026-01-02.jsonl");
    for (const f of [consumed, pending]) {
      fs.writeFileSync(f, "{}\n");
      fs.utimesSync(f, OLD, OLD);
    }
    fs.writeFileSync(path.join(data, "home", "state.json"), JSON.stringify({ version: 1, transcripts: {}, hooks: { "2026-01-01.jsonl": 3 }, sessions: {} }));
  }

  it("dry-run lists what would go and deletes nothing", async () => {
    seed();
    const res = await service(new Date("2027-02-01T00:00:00.000Z")).sweep({ dryRun: true });
    const kinds = res[0]?.items.map((i) => i.kind).sort();
    expect(kinds).toEqual(["index", "pack", "run", "spool"]);
    expect(fs.existsSync(path.join(data, "home", "runs", "s-old.jsonl"))).toBe(true);
    expect(readAll(indexFile())).toHaveLength(2);
  });

  it("removes runs, index lines, old packs and fully ingested spool files with a fake clock", async () => {
    seed();
    const svc = service(new Date("2027-02-01T00:00:00.000Z"));
    await svc.sweep({});
    expect(fs.existsSync(path.join(data, "home", "runs", "s-old.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(data, "home", "packs", "old.md"))).toBe(false);
    expect(fs.existsSync(path.join(data, "home", "packs", "fresh.md"))).toBe(true);
    expect(fs.existsSync(path.join(data, "home", "hooks", "2026-01-01.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(data, "home", "hooks", "2026-01-02.jsonl"))).toBe(true);
    expect(readAll(indexFile()).map((e) => e.runId)).toEqual(["s-new"]);
  });
});

function readAll(file: string): { runId: string }[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as { runId: string });
}
