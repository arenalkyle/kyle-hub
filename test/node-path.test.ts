import { describe, expect, it } from "vitest";
import { resolveNode } from "../src/node-path";

describe("resolveNode", () => {
  it("finds node on PATH", () => {
    expect(resolveNode("").ok).toBe(true);
  });
  it("reports a clear message for a bad path", () => {
    const r = resolveNode("definitely-not-node-xyz");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Node 18\+/);
  });
});
