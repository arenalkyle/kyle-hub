import { describe, expect, it } from "vitest";
import { RESUME_MS, RotationGate, rotateSpeedOf } from "./autoRotate";

describe("RotationGate", () => {
  it("rotates from the start", () => expect(new RotationGate().active(0)).toBe(true));
  it("pauses while held and resumes 5 s after release", () => {
    const g = new RotationGate();
    g.hold(1000);
    expect(g.active(60_000)).toBe(false);
    g.release(61_000);
    expect(g.active(61_000)).toBe(false);
    expect(g.active(61_000 + RESUME_MS - 1)).toBe(false);
    expect(g.active(61_000 + RESUME_MS)).toBe(true);
  });
  it("a momentary input (zoom) restarts the countdown", () => {
    const g = new RotationGate();
    g.input(1000);
    expect(g.active(5999)).toBe(false);
    g.input(5000);
    expect(g.active(9999)).toBe(false);
    expect(g.active(10_000)).toBe(true);
  });
  it("pauses during a camera flight and counts from its end", () => {
    const g = new RotationGate();
    g.setFlying(true, 0);
    expect(g.active(20_000)).toBe(false);
    g.setFlying(false, 20_000);
    expect(g.active(24_999)).toBe(false);
    expect(g.active(25_000)).toBe(true);
  });
  it("repeated flying=false does not restart the countdown", () => {
    const g = new RotationGate();
    g.setFlying(false, 100_000);
    expect(g.active(100_000)).toBe(true);
  });
});

describe("rotateSpeedOf", () => {
  it("clamps and defaults", () => {
    expect(rotateSpeedOf(undefined)).toBe(0.3);
    expect(rotateSpeedOf(5)).toBe(1);
    expect(rotateSpeedOf(-1)).toBe(0);
    expect(rotateSpeedOf(0)).toBe(0);
  });
});
