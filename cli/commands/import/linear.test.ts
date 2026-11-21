import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromLink } from "../../../src/core/domain/links";
import { parseIssue } from "../../../src/core/domain/issueFile";
import { formatFeedTime, formatIso } from "../../../src/core/domain/time";
import type { Io } from "../tickets/cli";
import { runKh } from "../../kh";
import { runImport, type LinearTransport } from "./linear";

const PAGES = (JSON.parse(fs.readFileSync(new URL("./fixtures/linear-pages.json", import.meta.url), "utf8")) as { pages: unknown[] }).pages;

let root: string;
let tickets: string;
let out: string[];
let err: string[];

const io = (env: Record<string, string> = { LINEAR_API_KEY: "test-key" }): Io => ({
  cwd: root,
  env,
  stdin: () => "",
  out: (s) => out.push(s),
  err: (s) => err.push(s),
  now: () => new Date("2026-11-21T12:00:00Z"),
});

/** Serves the recorded pages; the cursor is the page index. Records every request's variables. */
function fakeTransport(): LinearTransport & { calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    async request(_query, variables) {
      calls.push(variables);
      const index = variables.after === undefined ? 0 : Number(variables.after);
      return PAGES[index];
    },
  };
}

const issuesDir = (): string => path.join(tickets, "Issues");
const files = (): string[] => fs.readdirSync(issuesDir()).sort();
const load = (name: string) => parseIssue(fs.readFileSync(path.join(issuesDir(), name), "utf8"), name);

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "kh-import-"));
  tickets = path.join(root, "Tickets");
  fs.mkdirSync(tickets, { recursive: true });
  fs.writeFileSync(path.join(tickets, ".kyle-tickets.json"), "{}");
  out = [];
  err = [];
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("kh import linear", () => {
  it("maps fields, parents, labels and statuses from the recorded pages", async () => {
    const code = await runImport(["--team", "LOCK", "--dir", tickets], io(), fakeTransport());
    expect(code).toBe(0);
    expect(files()).toEqual(["TIX-1.md", "TIX-2.md", "TIX-3.md", "TIX-4.md"]);

    const parent = load("TIX-1.md");
    expect(parent).toMatchObject({ title: "Parent ticket", status: "In Progress", priority: "high", linearId: "LOCK-1", tags: ["ready-for-agent", "Feature"], description: "Parent **body**." });
    expect(parent.created).toBe(formatIso(new Date("2026-11-01T09:00:00.000Z")));

    const child = load("TIX-2.md");
    expect(child).toMatchObject({ status: "Done", priority: "none", linearId: "LOCK-2", description: "" });
    expect(fromLink(child.parent ?? "")).toBe("TIX-1");

    expect(load("TIX-3.md").status).toBe("Triage");
    expect(load("TIX-4.md")).toMatchObject({ status: "Todo", priority: "urgent" });
  });

  it("imports comments with original author and time (no spaces in authors)", async () => {
    await runImport(["--team", "LOCK", "--dir", tickets], io(), fakeTransport());
    const feed = load("TIX-2.md").feed.filter((e) => e.type === "comment");
    expect(feed.map((c) => [c.author, c.time, c.body])).toEqual([
      ["linear", formatFeedTime(new Date("2026-11-01T12:00:00.000Z")), "Second note"],
      ["Kyle-Arenal", formatFeedTime(new Date("2026-11-01T13:00:00.000Z")), "Third note"],
    ]);
    const parentFeed = load("TIX-1.md").feed.filter((e) => e.type === "comment");
    expect(parentFeed[0]).toMatchObject({ author: "Kyle-Arenal", body: "First note" });
  });

  it("follows cursors until hasNextPage is false", async () => {
    const t = fakeTransport();
    await runImport(["--team", "LOCK", "--dir", tickets], io(), t);
    expect(t.calls.map((v) => v.after)).toEqual([undefined, "1"]);
    expect(t.calls[0]!.filter).toEqual({ team: { key: { eq: "LOCK" } } });
  });

  it("re-running on the same fixture creates nothing new", async () => {
    await runImport(["--team", "LOCK", "--dir", tickets], io(), fakeTransport());
    const before = files().map((f) => [f, fs.readFileSync(path.join(issuesDir(), f), "utf8")]);
    out = [];
    const code = await runImport(["--team", "LOCK", "--dir", tickets], io(), fakeTransport());
    expect(code).toBe(0);
    expect(out.at(-1)).toContain("created 0, skipped 4");
    expect(files().map((f) => [f, fs.readFileSync(path.join(issuesDir(), f), "utf8")])).toEqual(before);
  });

  it("--dry-run reports the plan and writes nothing", async () => {
    const code = await runImport(["--team", "LOCK", "--dir", tickets, "--dry-run"], io(), fakeTransport());
    expect(code).toBe(0);
    expect(out[0]).toBe("would create TIX-1 <- LOCK-1 Parent ticket");
    expect(out.at(-1)).toContain("(dry run, nothing written)");
    expect(fs.existsSync(issuesDir())).toBe(false);
  });

  it("missing LINEAR_API_KEY is a clear error with exit code 2", async () => {
    const code = await runKh(["import", "linear", "--team", "LOCK", "--dir", tickets], io({}));
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("LINEAR_API_KEY is not set");
    expect(fs.existsSync(issuesDir())).toBe(false);
  });
});
