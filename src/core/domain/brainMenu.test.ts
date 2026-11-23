import { describe, expect, it } from "vitest";
import { CUSTOM_ORBIT_COLOR, DEFAULT_ORBIT_OPACITY, nextOrbitColor, normalizeOrbitColor, normalizeOrbitMode, normalizeOrbitOpacity, normalizeToasts, orbitColorKind, planBrainLeafMigration } from "./brainMenu";

describe("normalizeOrbitColor", () => {
  it("keeps the named modes", () => {
    expect(normalizeOrbitColor("default")).toBe("default");
    expect(normalizeOrbitColor("rainbow")).toBe("rainbow");
  });
  it("accepts 6 and 3 digit hex, lowercased, with or without #", () => {
    expect(normalizeOrbitColor("#FF8800")).toBe("#ff8800");
    expect(normalizeOrbitColor("ff8800")).toBe("#ff8800");
    expect(normalizeOrbitColor("#f80")).toBe("#ff8800");
    expect(normalizeOrbitColor("  #AbC ")).toBe("#aabbcc");
  });
  it("falls back to default for anything else", () => {
    for (const bad of ["", "#ff88", "#gggggg", "red", 12, null, undefined]) expect(normalizeOrbitColor(bad)).toBe("default");
  });
});

describe("orbit colour choice", () => {
  it("classifies the stored colour", () => {
    expect(orbitColorKind("default")).toBe("default");
    expect(orbitColorKind("rainbow")).toBe("rainbow");
    expect(orbitColorKind("#123456")).toBe("custom");
  });
  it("keeps the current hex when choosing custom again, else starts from white", () => {
    expect(nextOrbitColor("custom", "#123456")).toBe("#123456");
    expect(nextOrbitColor("custom", "rainbow")).toBe(CUSTOM_ORBIT_COLOR);
    expect(nextOrbitColor("rainbow", "#123456")).toBe("rainbow");
    expect(nextOrbitColor("default", "#123456")).toBe("default");
  });
});

describe("normalizeOrbitMode", () => {
  it("accepts the four modes and defaults the rest to drift", () => {
    expect(normalizeOrbitMode("solar")).toBe("solar");
    expect(normalizeOrbitMode("spin")).toBe("drift");
    expect(normalizeOrbitMode(undefined)).toBe("drift");
  });
});

describe("normalizeOrbitOpacity", () => {
  it("clamps to 0..1 and defaults non-numbers", () => {
    expect(normalizeOrbitOpacity(0.5)).toBe(0.5);
    expect(normalizeOrbitOpacity(-1)).toBe(0);
    expect(normalizeOrbitOpacity(3)).toBe(1);
    expect(normalizeOrbitOpacity("0.2")).toBe(DEFAULT_ORBIT_OPACITY);
    expect(normalizeOrbitOpacity(Number.NaN)).toBe(DEFAULT_ORBIT_OPACITY);
  });
});

describe("normalizeToasts", () => {
  it("keeps booleans and defaults to on", () => {
    expect(normalizeToasts(false)).toBe(false);
    expect(normalizeToasts(0)).toBe(true);
  });
});

describe("planBrainLeafMigration", () => {
  it("does nothing without saved brain leaves", () => {
    expect(planBrainLeafMigration(0, false)).toEqual({ convert: 0, close: 0 });
    expect(planBrainLeafMigration(0, true)).toEqual({ convert: 0, close: 0 });
  });
  it("converts one leaf to the Command Center and closes the extras", () => {
    expect(planBrainLeafMigration(1, false)).toEqual({ convert: 1, close: 0 });
    expect(planBrainLeafMigration(3, false)).toEqual({ convert: 1, close: 2 });
  });
  it("closes every brain leaf when a Command Center is already open", () => {
    expect(planBrainLeafMigration(2, true)).toEqual({ convert: 0, close: 2 });
  });
});
