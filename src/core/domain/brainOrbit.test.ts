import { describe, expect, it } from "vitest";
import { ORBIT_MODES } from "./brainMenu";
import { moonPosition, orbitPath, orbitPeriod, orbitPosition, orbitRadius, ORBIT_LINE_POINTS, type OrbitMode } from "./brainOrbit";

const R = 30;
const len = (p: readonly number[]): number => Math.hypot(p[0]!, p[1]!, p[2]!);

describe("orbitPosition", () => {
  it("sits outside the graph in every mode, about 1.3x for drift and still", () => {
    for (const m of ORBIT_MODES) for (let s = 0; s < 6; s++) for (const t of [0, 10, 500]) expect(len(orbitPosition(m, s, t, R))).toBeGreaterThan(R * 1.05);
    expect(orbitRadius("drift", 0, R)).toBeCloseTo(39);
    expect(len(orbitPosition("still", 2, 0, R))).toBeCloseTo(39);
  });

  it("still never moves and gives distinct slots distinct spots", () => {
    expect(orbitPosition("still", 1, 0, R)).toEqual(orbitPosition("still", 1, 999, R));
    expect(orbitPosition("still", 0, 0, R)).not.toEqual(orbitPosition("still", 1, 0, R));
    expect(orbitPosition("still", 0, 0, R)[1]).toBe(0);
  });

  it("drift wobbles vertically and moves over time", () => {
    const a = orbitPosition("drift", 0, 0, R), b = orbitPosition("drift", 0, 20, R);
    expect(a).not.toEqual(b);
    expect(Math.abs(b[1])).toBeLessThanOrEqual(R * 0.12 + 1e-9);
  });

  it("is deterministic: the same slot and time give the same spot", () => {
    for (const m of ORBIT_MODES) expect(orbitPosition(m, 3, 12.5, R)).toEqual(orbitPosition(m, 3, 12.5, R));
  });

  it("solar rings grow and slow outwards; atom rings are tilted", () => {
    expect(orbitRadius("solar", 2, R)).toBeGreaterThan(orbitRadius("solar", 0, R));
    expect(orbitPeriod("solar", 2)).toBeGreaterThan(orbitPeriod("solar", 0));
    const ys = [0, 3, 6, 9].map((t) => orbitPosition("atom", 0, t, R)[1]);
    expect(Math.max(...ys.map(Math.abs))).toBeGreaterThan(1);
    expect(orbitPeriod("still", 0)).toBe(Infinity);
  });
});

describe("orbitPath", () => {
  it("is empty for drift and still", () => {
    for (const m of ["drift", "still"] as OrbitMode[]) expect(orbitPath(m, 0, R).length).toBe(0);
  });
  it("is a closed ring of 129 points through the agent's slot for solar and atom", () => {
    for (const m of ["solar", "atom"] as OrbitMode[]) {
      const p = orbitPath(m, 1, R);
      expect(p.length).toBe(ORBIT_LINE_POINTS * 3);
      const first = [p[0], p[1], p[2]], last = [p[p.length - 3], p[p.length - 2], p[p.length - 1]];
      for (let i = 0; i < 3; i++) expect(first[i]).toBeCloseTo(last[i]!, 3);
      const agent = orbitPosition(m, 1, 0, R);
      for (let i = 0; i < 3; i++) expect(first[i]).toBeCloseTo(agent[i]!, 3);
      for (let i = 0; i < ORBIT_LINE_POINTS; i++) expect(len([p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!])).toBeCloseTo(orbitRadius(m, 1, R), 3);
    }
  });
});

describe("moonPosition", () => {
  it("circles the parent at a small distance", () => {
    const parent: [number, number, number] = [10, 20, 30];
    for (const t of [0, 1, 7]) {
      const m = moonPosition(parent, 0, t, R);
      const d = Math.hypot(m[0] - 10, m[1] - 20, m[2] - 30);
      expect(d).toBeGreaterThan(1);
      expect(d).toBeLessThan(R * 0.2);
    }
    expect(moonPosition(parent, 0, 0, R)).not.toEqual(moonPosition(parent, 1, 0, R));
  });
});
