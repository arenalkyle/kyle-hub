import { describe, expect, it } from "vitest";
import { buildGraph, withFolders, type BrainGraph } from "./brainGraph";
import { assignRegions, brainSdf, newShapeCache, regionAnchors, regionOf, shapeContains, shapeTargets, SHAPES, worldScale, type ShapeId } from "./brainShape";

function vault(folders: Record<string, number>, root = 0, withTree = true): BrainGraph {
  const notes: string[] = [];
  for (const [f, c] of Object.entries(folders)) for (let i = 0; i < c; i++) notes.push(`${f}/n${i}.md`);
  for (let i = 0; i < root; i++) notes.push(`r${i}.md`);
  const links: Record<string, Record<string, number>> = {};
  for (const p of notes) {
    const k = notes.indexOf(p);
    links[p] = { [notes[(k + 1) % notes.length]!]: 1 };
  }
  const g = buildGraph(notes, links);
  return withTree ? withFolders(g) : g;
}

const point = (pos: Float32Array, i: number): [number, number, number] => [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!];

describe("shapeTargets", () => {
  const eight = { A: 40, B: 30, C: 25, D: 20, E: 15, F: 12, G: 10, H: 8 };

  it("places the brain's notes inside the brain surface", () => {
    const g = vault(eight, 5);
    const pos = shapeTargets("brain", g, newShapeCache());
    const s = worldScale("brain", g.paths.length);
    expect(pos.length).toBe(g.paths.length * 3);
    for (let i = 0; i < g.paths.length; i++) {
      const [x, y, z] = point(pos, i);
      expect(Number.isFinite(x + y + z)).toBe(true);
      expect(brainSdf(x / s, y / s, z / s)).toBeLessThanOrEqual(0);
    }
  });

  it("holds each folder's notes inside its own region", () => {
    const g = vault(eight, 5);
    const cache = newShapeCache();
    shapeTargets("brain", g, cache);
    const ids = regionOf(g, cache);
    expect(new Set(ids).size).toBe(9);
    const anchors = regionAnchors("brain", g, cache);
    expect(anchors.map((a) => a.id).sort()).toEqual([...new Set(ids)].sort());
    for (const a of anchors) {
      const s = worldScale("brain", g.paths.length);
      expect(brainSdf(a.position[0] / s, a.position[1] / s, a.position[2] / s)).toBeLessThanOrEqual(0);
    }
  });

  it("keeps every other shape's points inside the shape", () => {
    const g = vault({ A: 30, B: 30 }, 4);
    const ids = SHAPES.map((s) => s.id).filter((id): id is Exclude<ShapeId, "default" | "brain"> => id !== "default" && id !== "brain");
    for (const id of ids) {
      const pos = shapeTargets(id, g, newShapeCache());
      const s = worldScale(id, g.paths.length);
      for (let i = 0; i < g.paths.length; i++) expect(shapeContains(id, pos[i * 3]! / s, pos[i * 3 + 1]! / s, pos[i * 3 + 2]! / s)).toBe(true);
      expect(pos.every(Number.isFinite)).toBe(true);
    }
  });

  it("is deterministic", () => {
    const g = vault(eight, 5);
    for (const id of ["brain", "sphere", "helix", "default"] as const) {
      const a = shapeTargets(id, g, newShapeCache());
      const b = shapeTargets(id, g, newShapeCache());
      expect(Array.from(a)).toEqual(Array.from(b));
    }
  });

  it("default is the plain force layout", () => {
    const g = vault({ A: 10 }, 0);
    expect(shapeTargets("default", g, newShapeCache()).length).toBe(g.paths.length * 3);
  });
});

describe("assignRegions", () => {
  it("keeps existing folders in their region when a note or folder is added", () => {
    const cache = newShapeCache();
    const before = assignRegions(vault({ A: 30, B: 20, C: 10 }, 2), cache);
    const slots = new Map(cache.slots);
    expect(before.length).toBe(4);
    assignRegions(vault({ A: 31, B: 20, C: 10 }, 2), cache);
    expect(new Map(cache.slots)).toEqual(slots);
    assignRegions(vault({ A: 31, B: 20, C: 10, Z: 100 }, 2), cache);
    for (const [f, s] of slots) expect(cache.slots.get(f)).toBe(s);
    expect(cache.slots.has("Z")).toBe(true);
  });

  it("gives bigger folders priority and sends folders beyond 8 to other (12 folders)", () => {
    const folders: Record<string, number> = {};
    for (let i = 0; i < 12; i++) folders[`F${String(i).padStart(2, "0")}`] = 10 + i * 5;
    const g = vault(folders, 0);
    const cache = newShapeCache();
    const regions = assignRegions(g, cache);
    const other = regions.find((r) => r.id === "other")!;
    expect(other.folders.length).toBe(4);
    // The four smallest folders are the ones that share "other".
    expect(other.folders.sort()).toEqual(["F00", "F01", "F02", "F03"]);
    expect(regions.length).toBe(10); // 8 folders + other + root
    const pos = shapeTargets("brain", g, cache);
    const s = worldScale("brain", g.paths.length);
    for (let i = 0; i < g.paths.length; i++) {
      const [x, y, z] = point(pos, i);
      expect(brainSdf(x / s, y / s, z / s)).toBeLessThanOrEqual(0);
    }
    expect(new Set(regionOf(g, cache)).size).toBe(10);
  });

  it("puts root notes in the root region and drops regions for removed folders", () => {
    const cache = newShapeCache();
    const r = assignRegions(vault({ A: 5 }, 3), cache);
    expect(r.map((x) => x.id)).toEqual(["folder:A", "root"]);
    assignRegions(vault({ B: 5 }, 0), cache);
    expect([...cache.slots.keys()]).toEqual(["B"]);
  });
});
