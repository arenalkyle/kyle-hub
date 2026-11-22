import { describe, expect, it } from "vitest";
import { normalizeFps } from "./fps";

describe("normalizeFps", () => {
  it("keeps the four offered rates", () => {
    expect([10, 20, 30, 60].map((v) => normalizeFps(v))).toEqual([10, 20, 30, 60]);
  });

  it("falls back to 30 for anything else", () => {
    expect(normalizeFps(undefined)).toBe(30);
    expect(normalizeFps("60")).toBe(30);
    expect(normalizeFps(45)).toBe(30);
  });
});
