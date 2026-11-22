import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeRedactor } from "../redact";
import { parseTranscriptLine, type ParseCtx, type ParseState } from "./parse";
import type { DerivedRecord, PriceTable } from "./types";

const FIXTURES = path.resolve(__dirname, "../../../test/fixtures/transcripts");
const PRICES: PriceTable = { "claude-test-1": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } };

function ctx(over: Partial<ParseCtx> = {}): ParseCtx {
  return { sessionId: "syn", cwd: "C:\\work\\demo", profile: "home", prices: PRICES, state: { pending: {} }, ...over };
}

describe("transcript parsing", () => {
  it("matches the golden derived records for the basic fixture", () => {
    const state: ParseState = { pending: {} };
    const c = ctx({ state });
    let skipped = 0;
    const out: DerivedRecord[] = [];
    for (const l of fs.readFileSync(path.join(FIXTURES, "session-basic.jsonl"), "utf8").split("\n").filter(Boolean)) {
      const recs = parseTranscriptLine(JSON.parse(l), c);
      if (recs === undefined) skipped++;
      else out.push(...recs);
    }
    const golden = JSON.parse(fs.readFileSync(path.join(FIXTURES, "session-basic.expected.json"), "utf8")) as { skipped: number; records: DerivedRecord[] };
    const red = makeRedactor({});
    expect(skipped).toBe(golden.skipped);
    expect(JSON.parse(red(JSON.stringify(out)))).toEqual(golden.records);
  });

  it("skips unknown record types instead of throwing", () => {
    expect(parseTranscriptLine({ type: "brand-new", timestamp: "2026-01-01T00:00:00.000Z" }, ctx())).toBeUndefined();
    expect(parseTranscriptLine("not an object", ctx())).toBeUndefined();
  });

  it("tolerates malformed message shapes", () => {
    expect(parseTranscriptLine({ type: "assistant", timestamp: "2026-01-01T00:00:00.000Z" }, ctx())).toEqual([]);
    expect(parseTranscriptLine({ type: "user", timestamp: "2026-01-01T00:00:00.000Z", message: { content: 5 } }, ctx())).toEqual([]);
  });

  it("emits usage once per message id", () => {
    const usage = { input_tokens: 1, output_tokens: 1 };
    const line = { type: "assistant", timestamp: "2026-01-01T00:00:00.000Z", message: { id: "m1", model: "claude-test-1", content: [{ type: "text", text: "a" }], usage } };
    const c = ctx();
    const first = parseTranscriptLine(line, c) ?? [];
    const second = parseTranscriptLine(line, c) ?? [];
    expect(first.filter((r) => r.type === "usage")).toHaveLength(1);
    expect(second.filter((r) => r.type === "usage")).toHaveLength(0);
  });

  it("omits the correction excerpt in the work profile", () => {
    const c = ctx({ profile: "work", state: { pending: {}, lastTool: "Bash" } });
    const recs = parseTranscriptLine({ type: "user", timestamp: "2026-01-01T00:00:00.000Z", message: { content: "use the other flag" } }, c) ?? [];
    expect(recs).toEqual([{ type: "user_correction", t: "2026-01-01T00:00:00.000Z", afterTool: "Bash" }]);
  });
});

describe("transcript search records (LOCK-65)", () => {
  const VAULT = "C:\\Vault";
  const CWD = "C:\\Vault\\proj";
  const call = (name: string, input: Record<string, unknown>, id = "tu1"): Record<string, unknown> => ({
    type: "assistant", timestamp: "2026-11-22T10:00:00.000Z", message: { id: `m-${id}`, model: "claude-test-1", content: [{ type: "tool_use", id, name, input }] },
  });
  const result = (content: unknown, id = "tu1", is_error = false): Record<string, unknown> => ({
    type: "user", timestamp: "2026-11-22T10:00:02.000Z", message: { content: [{ type: "tool_result", tool_use_id: id, is_error, ...(content === undefined ? {} : { content }) }] },
  });
  const run = (lines: Record<string, unknown>[], over: Partial<ParseCtx> = {}): DerivedRecord[] => {
    const c = ctx({ cwd: CWD, vaultRoot: VAULT, ...over });
    return lines.flatMap((l) => parseTranscriptLine(l, c) ?? []);
  };
  const searches = (recs: DerivedRecord[]): DerivedRecord[] => recs.filter((r) => r.type === "search");

  it("records a zero-hit Grep with its vault-relative root and pattern", () => {
    const recs = run([call("Grep", { pattern: "needle", path: "C:\\Vault\\proj\\src" }), result("No files found")]);
    expect(searches(recs)).toEqual([{ type: "search", t: "2026-11-22T10:00:02.000Z", tool: "Grep", root: "proj/src", pattern: "needle", hits: 0, durationMs: 2000 }]);
  });

  it("counts a many-hit Glob from its result header and defaults the root to the cwd", () => {
    const body = `Found 12 files\n${Array.from({ length: 12 }, (_, i) => `C:\\Vault\\proj\\f${i}.md`).join("\n")}`;
    const recs = run([call("Glob", { pattern: "**/*.md" }), result(body)]);
    expect(searches(recs)[0]).toMatchObject({ tool: "Glob", root: "proj", pattern: "**/*.md", hits: 12 });
    expect(JSON.stringify(recs)).not.toContain("f0.md");
  });

  it("counts array-shaped tool_result text", () => {
    const recs = run([call("Grep", { pattern: "x" }), result([{ type: "text", text: "a.md\nb.md" }])]);
    expect(searches(recs)[0]).toMatchObject({ root: "proj", hits: 2 });
  });

  it("drops a search whose root is outside the vault but keeps the tool_call", () => {
    const recs = run([call("Grep", { pattern: "x", path: "D:\\other" }), result("No files found")]);
    expect(searches(recs)).toEqual([]);
    expect(recs.some((r) => r.type === "tool_call" && r.tool === "Grep")).toBe(true);
  });

  it("drops every search when no vault root is configured", () => {
    const recs = run([call("Grep", { pattern: "x" }), result("No files found")], { vaultRoot: undefined });
    expect(searches(recs)).toEqual([]);
  });

  it("marks an old-format result without countable content as unknown hits", () => {
    const recs = run([call("Grep", { pattern: "x" }), result(undefined)]);
    const s = searches(recs)[0];
    expect(s).toBeDefined();
    expect(s).not.toHaveProperty("hits");
  });

  it("emits no search record for a failed search", () => {
    const recs = run([call("Grep", { pattern: "[" }), result("bad regex", "tu1", true)]);
    expect(searches(recs)).toEqual([]);
  });
});
