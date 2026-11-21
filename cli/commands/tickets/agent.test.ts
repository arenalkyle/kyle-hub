import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run as ticketsRun, type Io } from "./cli";

let root: string;
let out: string[];
let err: string[];
let clock: Date;

const issueFile = (id: string): string => path.join(root, "Tickets", "Issues", `${id}.md`);
const read = (id: string): string => fs.readFileSync(issueFile(id), "utf8");

function kt(args: string[], env: Record<string, string> = {}): number {
  out = [];
  err = [];
  const io: Io = { cwd: path.join(root, "Tickets"), env, stdin: () => "", out: (s) => out.push(s), err: (s) => err.push(s), now: () => clock };
  return ticketsRun(args, io);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "kh-agent-"));
  fs.mkdirSync(path.join(root, "Tickets", "Issues"), { recursive: true });
  fs.mkdirSync(path.join(root, "Tickets", "Projects"));
  fs.writeFileSync(path.join(root, "Tickets", ".kyle-tickets.json"), JSON.stringify({ prefix: "TIX", version: 1 }));
  clock = new Date(2026, 10, 21, 10, 30, 0);
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("agent gates", () => {
  it("forces triage and records source; human mode unaffected", () => {
    expect(kt(["new", "Agent idea", "--type", "proposal"], { KH_AGENT: "1", KH_RUN: "run-7" })).toBe(0);
    expect(out).toEqual(["TIX-1"]);
    expect(read("TIX-1")).toMatch(/status: Triage/);
    expect(read("TIX-1")).toMatch(/source: agent:run-7/);
    expect(read("TIX-1")).toMatch(/type: proposal/);

    expect(kt(["new", "Human task", "--status", "Todo"], {})).toBe(0);
    expect(read("TIX-2")).toMatch(/status: Todo/);
    expect(read("TIX-2")).not.toMatch(/source:/);
  });

  it("refuses agent-ready and completed statuses with a non-zero exit", () => {
    kt(["new", "Seed"], {});
    expect(kt(["set", "TIX-1", "labels", "+agent-ready"], { KH_AGENT: "1" })).not.toBe(0);
    expect(err.join("\n")).toMatch(/agent-ready/);
    expect(kt(["set", "TIX-1", "status", "Done"], { KH_AGENT: "1" })).not.toBe(0);
    expect(kt(["set", "TIX-1", "labels", "+agent-ready"], {})).toBe(0);
  });
});

describe("comment authorship", () => {
  it("authors as agent:<KH_RUN> inside a run so session end can find the summary; --as and humans unaffected", () => {
    kt(["new", "Seed"], {});
    expect(kt(["comment", "TIX-1", "all done"], { KH_RUN: "r-20261121-100000-TIX-1", KT_AUTHOR: "kyle" })).toBe(0);
    expect(read("TIX-1")).toMatch(/@agent:r-20261121-100000-TIX-1/);
    expect(kt(["comment", "TIX-1", "by hand", "--as", "bob"], { KH_RUN: "r1" })).toBe(0);
    expect(read("TIX-1")).toMatch(/@bob/);
    expect(kt(["comment", "TIX-1", "human"], { KT_AUTHOR: "kyle" })).toBe(0);
    expect(read("TIX-1")).toMatch(/@kyle/);
  });
});

describe("dedupe and caps", () => {
  it("adds a seen-again comment instead of a second file", () => {
    kt(["new", "Refactor the Thing 1", "--type", "proposal"], { KH_AGENT: "1", KH_RUN: "r1" });
    expect(kt(["new", "refactor THE thing 2", "--type", "proposal"], { KH_AGENT: "1", KH_RUN: "r2" })).toBe(0);
    expect(out).toEqual(["TIX-1"]);
    expect(fs.readdirSync(path.join(root, "Tickets", "Issues"))).toEqual(["TIX-1.md"]);
    expect(read("TIX-1")).toMatch(/seen again \(\+1\) from agent:r2/);
  });

  it("caps five new triage tickets per run with exit code 3", () => {
    for (let n = 0; n < 5; n++) expect(kt(["new", `Unique topic ${"abcdefghij"[n]!.repeat(3)}`], { KH_AGENT: "1", KH_RUN: "cap" })).toBe(0);
    expect(kt(["new", "One too many"], { KH_AGENT: "1", KH_RUN: "cap" })).toBe(3);
    expect(err.join("\n")).toMatch(/Per-run cap/);
  });
});

describe("expire", () => {
  it("cancels triage tickets untouched for 14 days, with an expired event", () => {
    kt(["new", "Old proposal"], { KH_AGENT: "1", KH_RUN: "e1" });
    clock = new Date(2026, 10, 21 + 15, 10, 30, 0);
    expect(kt(["expire"], {})).toBe(0);
    expect(out).toEqual(["TIX-1 expired"]);
    expect(read("TIX-1")).toMatch(/status: Canceled/);
    expect(read("TIX-1")).toMatch(/expired \(no update for 14 days\)/);
  });

  it("leaves fresh triage tickets alone", () => {
    kt(["new", "Fresh proposal"], { KH_AGENT: "1", KH_RUN: "e2" });
    expect(kt(["expire"], {})).toBe(0);
    expect(out).toEqual(["0 expired"]);
    expect(read("TIX-1")).toMatch(/status: Triage/);
  });
});
