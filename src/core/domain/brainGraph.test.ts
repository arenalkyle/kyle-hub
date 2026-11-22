import { describe, expect, it } from "vitest";
import { buildGraph } from "./brainGraph";
import { forceLayout } from "./forceLayout";
import { countReads, heatOf } from "./brainHeat";

describe("buildGraph", () => {
  it("dedupes, makes edges undirected, drops self and non-note targets, keeps orphans", () => {
    const g = buildGraph(["b.md", "a.md", "c.md", "a.md"], { "a.md": { "b.md": 2, "a.md": 1, "x.png": 1 }, "b.md": { "a.md": 1 } });
    expect(g.paths).toEqual(["a.md", "b.md", "c.md"]);
    expect(g.edges).toEqual([[0, 1]]);
    expect(g.degree).toEqual([1, 1, 0]);
  });
});

describe("forceLayout", () => {
  const edges: [number, number][] = [[0, 1], [1, 2], [2, 3]];
  it("is deterministic and finite", () => {
    const a = forceLayout(5, edges, { seed: 7 });
    const b = forceLayout(5, edges, { seed: 7 });
    expect([...a]).toEqual([...b]);
    expect([...a].every(Number.isFinite)).toBe(true);
  });
  it("keeps fixed nodes in place and pulls linked nodes near each other", () => {
    const p = forceLayout(4, edges, { fixed: new Map([[0, [0, 0, 0]]]), seed: 3 });
    expect([p[0], p[1], p[2]]).toEqual([0, 0, 0]);
    const d = Math.hypot(p[9]! - p[0]!, p[10]! - p[1]!, p[11]! - p[2]!);
    expect(d).toBeLessThan(40);
  });
  it("handles empty, single and large graphs", () => {
    expect(forceLayout(0, []).length).toBe(0);
    expect(forceLayout(1, []).length).toBe(3);
    const big = forceLayout(1000, [], { iterations: 5 });
    expect([...big].every(Number.isFinite)).toBe(true);
  });
});

describe("heat", () => {
  const now = Date.parse("2026-11-22T00:00:00Z");
  const day = 86_400_000;
  const iso = (d: number): string => new Date(now - d * day).toISOString();
  it("counts reads in 7/30/90 windows and ignores older or pathless", () => {
    const m = countReads(
      [
        { t: iso(1), path: "a.md" },
        { t: iso(20), path: "./a.md" },
        { t: iso(60), path: "a.md" },
        { t: iso(100), path: "a.md" },
        { t: iso(1) },
      ],
      now,
    );
    expect(m.get("a.md")).toMatchObject({ d7: 1, d30: 2, d90: 3 });
  });
  it("hot notes are hot and fresh; old untouched notes are dim", () => {
    const hot = heatOf({ d7: 5, d30: 10, d90: 20, last: now - day }, 0, now);
    expect(hot.heat).toBeGreaterThan(0.8);
    expect(hot.dim).toBe(0);
    expect(heatOf(undefined, now - 120 * day, now)).toEqual({ heat: 0, dim: 1 });
    expect(heatOf(undefined, now - 60 * day, now).dim).toBeCloseTo(0.5);
  });
});
