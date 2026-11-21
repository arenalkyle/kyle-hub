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
