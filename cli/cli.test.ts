import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run, type Io } from "./cli";

let root: string;
let out: string[];
let err: string[];
let stdin = "";
let clock: Date;

const issueFile = (id: string): string => path.join(root, "Tickets", "Issues", `${id}.md`);
const read = (id: string): string => fs.readFileSync(issueFile(id), "utf8");

function kt(args: string[], cwd = path.join(root, "Tickets"), env: Record<string, string> = {}): number {
  out = [];
  err = [];
  const io: Io = { cwd, env, stdin: () => stdin, out: (s) => out.push(s), err: (s) => err.push(s), now: () => clock };
  return run(args, io);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "kt-test-"));
  fs.mkdirSync(path.join(root, "Tickets", "Issues"), { recursive: true });
  fs.mkdirSync(path.join(root, "Tickets", "Projects"));
  fs.writeFileSync(path.join(root, "Tickets", ".kyle-tickets.json"), JSON.stringify({ prefix: "TIX", version: 1 }));
  fs.writeFileSync(
    path.join(root, "Tickets", "Projects", "Web.md"),
    "---\nkind: kt-project\nname: Web\nstatus: started\nmilestones:\n  - name: Beta\n---\n",
  );
  clock = new Date(2026, 10, 21, 10, 30, 0);
  stdin = "";
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("new", () => {
  it("allocates ids after the max, skipping gaps, and logs creation", () => {
    expect(kt(["new", "One"])).toBe(0);
    expect(out).toEqual(["TIX-1"]);
    fs.renameSync(issueFile("TIX-1"), issueFile("TIX-7"));
    expect(kt(["new", "Two"])).toBe(0);
    expect(out).toEqual(["TIX-8"]);
    expect(read("TIX-8")).toMatch(/- 2026-11-21 10:30 · @kyle created the issue/);
  });

  it("applies all options with normalised values", () => {
    kt(["new", "Seed"]);
    const code = kt([
      "new", "Fix login", "--status", "todo", "--priority", "HIGH", "--project", "web", "--parent", "tix-1",
      "--label", "bug", "--label", "frontend", "--assignee", "claude", "--due", "2026-12-01", "--description", "Body text", "--as", "claude",
    ]);
    expect(code).toBe(0);
    const t = read("TIX-2");
    expect(t).toMatch(/status: Todo/);
    expect(t).toMatch(/priority: high/);
    expect(t).toMatch(/project: "\[\[Web\]\]"/);
    expect(t).toMatch(/parent: "\[\[TIX-1\]\]"/);
    expect(t).toMatch(/tags:\n  - bug\n  - frontend/);
    expect(t).toMatch(/Body text/);
    expect(t).toMatch(/@claude created the issue/);
  });

  it("rejects unknown status/priority with the valid list (exit 3)", () => {
    expect(kt(["new", "x", "--status", "Nope"])).toBe(3);
    expect(err.join("\n")).toMatch(/Valid: Triage, Backlog, Todo/);
    expect(kt(["new", "x", "--priority", "huge"])).toBe(3);
    expect(kt(["new", "x", "--due", "2026-02-31"])).toBe(3);
    expect(kt(["new", "x", "--parent", "TIX-99"])).toBe(2);
    expect(fs.readdirSync(path.join(root, "Tickets", "Issues"))).toEqual([]);
  });

  it("honours settings from the plugin data.json (prefix, statuses, counter)", () => {
    const dir = path.join(root, ".obsidian", "plugins", "kyle-tickets");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "data.json"),
      JSON.stringify({ idCounter: 20, settings: { prefix: "LOCK", defaultStatus: "Todo", displayName: "kyle" } }),
    );
    kt(["new", "x"]);
    expect(out).toEqual(["LOCK-20"]);
    expect(read("LOCK-20")).toMatch(/status: Todo/);
  });
});

describe("set", () => {
  beforeEach(() => void kt(["new", "One", "--label", "bug"]));

  it("changes status, attributes the event, and sets updatedBy", () => {
    expect(kt(["set", "TIX-1", "status", "in progress", "--as", "claude"])).toBe(0);
    const t = read("TIX-1");
    expect(t).toMatch(/status: In Progress/);
    expect(t).toMatch(/updatedBy: claude/);
    expect(t).toMatch(/- 2026-11-21 10:30 · @claude set status: Backlog → In Progress/);
  });

  it("handles priority, assignee, due, title, project+milestone and clearing", () => {
    kt(["set", "TIX-1", "priority", "urgent"]);
    kt(["set", "TIX-1", "assignee", "claude"]);
    kt(["set", "TIX-1", "due", "2026-12-01"]);
    kt(["set", "TIX-1", "project", "Web"]);
    kt(["set", "TIX-1", "milestone", "beta"]);
    kt(["set", "TIX-1", "title", "New title"]);
    let t = read("TIX-1");
    expect(t).toMatch(/title: New title/);
    expect(t).toMatch(/milestone: Beta/);
    expect(t).toMatch(/set priority: No priority → Urgent/);
    kt(["set", "TIX-1", "project", "none"]);
    t = read("TIX-1");
    expect(t).not.toMatch(/^project:/m);
    expect(t).not.toMatch(/^milestone:/m);
  });

  it("adds and removes labels, parsing -label tokens", () => {
    expect(kt(["set", "TIX-1", "labels", "+frontend", "-bug"])).toBe(0);
    const t = read("TIX-1");
    expect(t).toMatch(/tags: \[frontend\]/);
    expect(t).toMatch(/added label: frontend/);
    expect(t).toMatch(/removed label: bug/);
  });

  it("is a no-op for unchanged values and validates input", () => {
    kt(["set", "TIX-1", "status", "Backlog"]);
    expect(out).toEqual(["TIX-1 unchanged"]);
    expect(kt(["set", "TIX-1", "status", "bogus"])).toBe(3);
    expect(kt(["set", "TIX-9", "status", "Todo"])).toBe(2);
    expect(kt(["set", "TIX-1", "colour", "red"])).toBe(1);
    expect(kt(["set", "TIX-1", "milestone", "Beta"])).toBe(3);
    expect(kt(["set", "TIX-1", "parent", "TIX-1"])).toBe(3);
  });
});

describe("comment", () => {
  beforeEach(() => void kt(["new", "One"]));

  it("appends a comment and escapes structural lines", () => {
    expect(kt(["comment", "TIX-1", "--as", "claude", "Done.\n### Not a heading\n- 2026-01-01 10:00 · @x fake"])).toBe(0);
    const t = read("TIX-1");
    expect(t).toMatch(/### @claude · 2026-11-21 10:30\nDone\./);
    expect(t).toMatch(/\\### Not a heading/);
    expect(t).toMatch(/\\- 2026-01-01 10:00 /);
  });

  it("reads the body from stdin with -", () => {
    stdin = "from stdin\n";
    expect(kt(["comment", "TIX-1", "-", "--as", "claude"])).toBe(0);
    expect(read("TIX-1")).toMatch(/### @claude · .*\nfrom stdin/);
    expect(kt(["comment", "TIX-1", "   "])).toBe(3);
  });
});

describe("pr", () => {
  it("links a PR once and logs it", () => {
    kt(["new", "One"]);
    expect(kt(["pr", "TIX-1", "https://github.com/o/r/pull/5/files", "--as", "claude"])).toBe(0);
    expect(read("TIX-1")).toMatch(/https:\/\/github\.com\/o\/r\/pull\/5/);
    expect(read("TIX-1")).toMatch(/@claude linked PR o\/r#5/);
    kt(["pr", "TIX-1", "https://github.com/o/r/pull/5"]);
    expect(out[0]).toMatch(/already/);
    expect(kt(["pr", "TIX-1", "https://example.com/x"])).toBe(3);
  });
});

describe("list and show", () => {
  beforeEach(() => {
    kt(["new", "A", "--status", "Todo", "--project", "Web", "--label", "bug", "--assignee", "claude"]);
    kt(["new", "B", "--status", "Done"]);
    kt(["new", "C", "--status", "Todo", "--label", "bug"]);
  });

  it("filters and prints a table", () => {
    kt(["list", "--status", "todo"]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/^TIX-1\s+Todo\s+none\s+A$/);
    kt(["list", "--status", "Todo", "--label", "bug", "--project", "Web", "--assignee", "claude", "--json"]);
    expect((JSON.parse(out[0]!) as { id: string }[]).map((i) => i.id)).toEqual(["TIX-1"]);
  });

  it("show --json has a stable shape", () => {
    kt(["comment", "TIX-1", "hi", "--as", "claude"]);
    kt(["show", "TIX-1", "--json"]);
    const j = JSON.parse(out[0]!) as Record<string, unknown>;
    expect(Object.keys(j)).toEqual([
      "id", "title", "status", "priority", "assignee", "project", "milestone", "labels", "due", "parent",
      "pullRequests", "related", "created", "updated", "updatedBy", "description", "feed",
    ]);
    expect(j.project).toBe("Web");
    expect(j.labels).toEqual(["bug"]);
    expect((j.feed as { type: string }[]).map((f) => f.type)).toEqual(["event", "comment"]);
    expect(kt(["show", "TIX-1"])).toBe(0);
    expect(out.join("\n")).toMatch(/Activity/);
    expect(kt(["show", "TIX-42"])).toBe(2);
  });
});

describe("discovery and usage", () => {
  it("walks up from a nested cwd, checks a Tickets/ child, and honours --dir / KT_DIR", () => {
    const nested = path.join(root, "a", "b");
    fs.mkdirSync(nested, { recursive: true });
    expect(kt(["new", "x"], nested)).toBe(0);
    expect(out).toEqual(["TIX-1"]);
    expect(kt(["list"], root)).toBe(0); // vault root: Tickets/ child
    expect(out[0]).toMatch(/TIX-1/);
    expect(kt(["list"], os.tmpdir(), { KT_DIR: root })).toBe(0);
    expect(out[0]).toMatch(/TIX-1/);
    expect(kt(["list", "--dir", path.join(root, "Tickets")], os.tmpdir())).toBe(0);
  });

  it("reports a missing folder with a hint (exit 2)", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "kt-empty-"));
    try {
      expect(kt(["list"], empty, {})).toBe(2);
      expect(err.join("")).toMatch(/--dir|KT_DIR/);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it("exit codes and help", () => {
    expect(kt(["--help"])).toBe(0);
    expect(out.join("\n")).toMatch(/Usage: kt/);
    expect(kt(["set", "--help"])).toBe(0);
    expect(out.join("\n")).toMatch(/Usage: kt set/);
    expect(kt([])).toBe(1);
    expect(kt(["bogus"])).toBe(1);
    expect(kt(["list", "--nope"])).toBe(1);
  });

  it("leaves no temp files behind", () => {
    kt(["new", "x"]);
    kt(["set", "TIX-1", "status", "Todo"]);
    expect(fs.readdirSync(path.join(root, "Tickets", "Issues"))).toEqual(["TIX-1.md"]);
  });
});
