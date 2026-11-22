import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileLogService, readNewLines } from "./service";
import type { PriceTable, Profile } from "./types";

const FIXTURE = path.resolve(__dirname, "../../../test/fixtures/transcripts/session-basic.jsonl");
const PRICES: PriceTable = { "claude-test-1": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } };
const SID = "syn-session-1";

let root: string;
let projects: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "kh-logs-"));
  projects = path.join(root, "claude", "projects", "proj");
  fs.mkdirSync(projects, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const dataRoot = (sub: string) => (p: Profile) => path.join(root, sub, p);
const transcript = (): string => path.join(projects, `${SID}.jsonl`);
const runsFile = (sub: string, runId: string, p: Profile = "home") => path.join(root, sub, p, "runs", `${runId}.jsonl`);

function service(sub = "data", extra: { repoMap?: { path: string; profile: Profile }[]; denylist?: string[] } = {}) {
  return new FileLogService({
    dataRoot: dataRoot(sub),
    projectsDir: path.join(root, "claude", "projects"),
    prices: PRICES,
    ...extra,
  });
}

describe("LogService ingest", () => {
  it("writes redacted derived records, skipping unknown lines", async () => {
    fs.copyFileSync(FIXTURE, transcript());
    const res = await service().ingest({ profile: "home" });
    expect(res.skipped).toBe(2);
    expect(res.runsUpdated).toBe(1);
    expect(res.records).toBeGreaterThan(10);
    const text = fs.readFileSync(runsFile("data", `s-${SID}`), "utf8");
    const lines = text.trim().split("\n").map((l) => JSON.parse(l) as { type: string; runId: string });
    expect(lines[0]?.type).toBe("run");
    expect(lines.every((l) => l.runId === `s-${SID}`)).toBe(true);
    expect(text).not.toContain("hunter2secret");
    expect(text).not.toContain("ghp_");
    expect(text).toContain("[REDACTED:password]");
    expect(text).toContain('"costUsd":0.0008775');
  });

  it("sessionId limits transcript ingest to that session", async () => {
    fs.copyFileSync(FIXTURE, path.join(projects, "other-session.jsonl"));
    expect((await service("only").ingest({ sessionId: "nope" })).runsUpdated).toBe(0);
    expect((await service("only").ingest({ sessionId: "other-session" })).runsUpdated).toBe(1);
  });

  it("annotateRun records outcome and summaryCommented in the index and survives re-ingest", async () => {
    fs.copyFileSync(FIXTURE, transcript());
    const svc = service();
    await svc.ingest();
    await svc.annotateRun(`s-${SID}`, { outcome: "partial", summaryCommented: false });
    await svc.annotateRun("s-missing", { outcome: "x" });
    expect(await svc.run(`s-${SID}`)).toMatchObject({ outcome: "partial", summaryCommented: false });
    fs.appendFileSync(transcript(), "");
    await svc.ingest();
    expect(await svc.run(`s-${SID}`)).toMatchObject({ outcome: "partial" });
  });

  it("is idempotent when nothing new arrived", async () => {
    fs.copyFileSync(FIXTURE, transcript());
    const svc = service();
    await svc.ingest();
    const runs = fs.readFileSync(runsFile("data", `s-${SID}`), "utf8");
    const state = fs.readFileSync(path.join(root, "data", "home", "state.json"), "utf8");
    const again = await svc.ingest();
    expect(again).toEqual({ runsUpdated: 0, records: 0, skipped: 0 });
    expect(fs.readFileSync(runsFile("data", `s-${SID}`), "utf8")).toBe(runs);
    expect(fs.readFileSync(path.join(root, "data", "home", "state.json"), "utf8")).toBe(state);
  });

  it("holds a partial last line and never duplicates or loses lines across appends", async () => {
    const full = fs.readFileSync(FIXTURE);
    const cut = full.indexOf(0x0a, full.length / 2) + 10; // mid-line
    fs.writeFileSync(transcript(), full.subarray(0, cut));
    const svc = service("split");
    await svc.ingest();
    fs.appendFileSync(transcript(), full.subarray(cut));
    await svc.ingest();

    fs.writeFileSync(path.join(projects, `${SID}.jsonl`), full);
    await service("single").ingest();
    expect(fs.readFileSync(runsFile("split", `s-${SID}`), "utf8")).toBe(fs.readFileSync(runsFile("single", `s-${SID}`), "utf8"));
  });

  it("merges hook events by KH_RUN and ticket into the run", async () => {
    fs.copyFileSync(FIXTURE, transcript());
    const svc = service();
    svc.appendHookEvent({ sessionId: SID, name: "Stop", state: "finished", runId: "KH-RUN-1", ticketId: "LOCK-1", t: "2026-01-01T09:59:59.000Z" });
    await svc.ingest({ profile: "home" });
    expect(fs.existsSync(runsFile("data", "KH-RUN-1"))).toBe(true);
    expect(fs.existsSync(runsFile("data", `s-${SID}`))).toBe(false);
    const text = fs.readFileSync(runsFile("data", "KH-RUN-1"), "utf8");
    expect(text).toContain('"type":"hook","t":"2026-01-01T09:59:59.000Z","name":"Stop","state":"finished"');
    expect(text).toContain('"type":"run_meta"');
  });

  it("routes sessions by repo map and omits correction excerpts in work", async () => {
    fs.copyFileSync(FIXTURE, transcript());
    await service("data", { repoMap: [{ path: "C:\\work", profile: "work" }] }).ingest();
    const text = fs.readFileSync(runsFile("data", `s-${SID}`, "work"), "utf8");
    expect(text).toContain("user_correction");
    expect(text).not.toContain("excerpt");
    expect(fs.existsSync(runsFile("data", `s-${SID}`, "home"))).toBe(false);
  });

  it("redacts values from the run repo's .env files", async () => {
    const repo = path.join(root, "repo");
    fs.mkdirSync(repo);
    fs.writeFileSync(path.join(repo, ".env.local"), "APP_SECRET=abcdef-secret-token\n");
    const base = { sessionId: SID, cwd: repo };
    const call = { ...base, type: "assistant", timestamp: "2026-01-01T10:00:00.000Z", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "env" } }] } };
    const result = { ...base, type: "user", timestamp: "2026-01-01T10:00:01.000Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "fatal: APP_SECRET=abcdef-secret-token" }] } };
    fs.writeFileSync(transcript(), [call, result].map((l) => JSON.stringify(l)).join("\n") + "\n");
    const svc = service();
    await svc.ingest();
    await svc.ingest();
    const text = fs.readFileSync(runsFile("data", `s-${SID}`), "utf8");
    expect(text).not.toContain("abcdef-secret-token");
    expect(text).toContain("[REDACTED:env]");
  });
});

describe("readNewLines", () => {
  it("returns complete lines and the byte count consumed", async () => {
    const f = path.join(root, "x.jsonl");
    fs.writeFileSync(f, "one\r\ntwo\npart");
    expect(await readNewLines(f, 0)).toEqual({ lines: ["one", "two"], consumed: 9 });
    expect(await readNewLines(f, 9)).toEqual({ lines: [], consumed: 0 });
  });
});

describe("human_open spool (LOCK-65)", () => {
  it("appends human_open lines to the profile's human spool by day", () => {
    const svc = service("data");
    svc.appendHumanOpen({ profile: "work", path: "Brain/a.md", t: "2026-11-22T09:00:00.000Z" });
    svc.appendHumanOpen({ profile: "work", path: "Tickets/b.md", t: "2026-11-22T09:01:00.000Z" });
    const file = path.join(root, "data", "work", "human", "2026-11-22.jsonl");
    const lines = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toEqual([
      { type: "human_open", t: "2026-11-22T09:00:00.000Z", path: "Brain/a.md" },
      { type: "human_open", t: "2026-11-22T09:01:00.000Z", path: "Tickets/b.md" },
    ]);
  });
});
