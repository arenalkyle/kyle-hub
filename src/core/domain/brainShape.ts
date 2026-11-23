/**
 * Shapes for the 3D brain: where every note sits for each shape. Pure (no obsidian/three), deterministic.
 *
 * Shape tests are point-in-shape functions over normalised coordinates (the Hivemynd approach, see NOTICE).
 * Notes are placed by a force layout held inside the shape's volume; for the `brain` shape each top-level
 * folder additionally gets a region of the brain and its notes are held inside that region.
 *
 * Axes: +x right, +y up, +z toward the front of the brain.
 */
import { forceLayout } from "./forceLayout";
import { ROOT_FOLDER, type BrainGraph } from "./brainGraph";

export type ShapeId = "default" | "sphere" | "cube" | "diamond" | "pyramid" | "star" | "heart" | "ring" | "helix" | "galaxy" | "brain";

export const SHAPES: readonly { id: ShapeId; name: string }[] = [
  { id: "default", name: "Default" },
  { id: "brain", name: "Brain" },
  { id: "sphere", name: "Sphere" },
  { id: "cube", name: "Cube" },
  { id: "diamond", name: "Diamond" },
  { id: "pyramid", name: "Pyramid" },
  { id: "star", name: "Star" },
  { id: "heart", name: "Heart" },
  { id: "ring", name: "Ring" },
  { id: "helix", name: "Double helix" },
  { id: "galaxy", name: "Galaxy" },
];

type Vec3 = readonly [number, number, number];
type Inside = (x: number, y: number, z: number) => boolean;

// ---------------------------------------------------------------- brain signed distance field

const smin = (a: number, b: number, k: number): number => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

/** Approximate signed distance to an axis-aligned ellipsoid (negative inside). */
const ell = (x: number, y: number, z: number, c: Vec3, r: Vec3): number =>
  (Math.hypot((x - c[0]) / r[0], (y - c[1]) / r[1], (z - c[2]) / r[2]) - 1) * Math.min(r[0], r[1], r[2]);

/** Superellipsoid (exponent e > 2 is boxier), approximate distance. */
const sell = (x: number, y: number, z: number, c: Vec3, r: Vec3, e: number): number =>
  (Math.pow(Math.pow(Math.abs((x - c[0]) / r[0]), e) + Math.pow(Math.abs((y - c[1]) / r[1]), e) + Math.pow(Math.abs((z - c[2]) / r[2]), e), 1 / e) - 1) * Math.min(r[0], r[1], r[2]);

const hash3 = (x: number, y: number, z: number): number => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1;
};

/** Smooth 3D value noise in [-1, 1]. */
function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number): number => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number): number => hash3(xi + dx, yi + dy, zi + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), sx), l(c(0, 1, 0), c(1, 1, 0), sx), sy),
    l(l(c(0, 0, 1), c(1, 0, 1), sx), l(c(0, 1, 1), c(1, 1, 1), sx), sy),
    sz,
  );
}

const capsule = (x: number, y: number, z: number, a: Vec3, b: Vec3, r: number): number => {
  const px = x - a[0], py = y - a[1], pz = z - a[2];
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const t = Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz)));
  return Math.hypot(px - bx * t, py - by * t, pz - bz * t) - r;
};

/** Signed distance to the brain surface in unit coordinates (negative inside). */
export function brainSdf(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  // One hemisphere (mirrored): parietal bulk, frontal, occipital and temporal lobes.
  const taper = 1 - 0.22 * Math.max(0, Math.min(1, (0.05 - y) / 0.45));
  let h = sell(ax / taper, y, z, [0.36, 0.12, -0.02], [0.42, 0.48, 0.86], 2.1) * taper;
  h = smin(h, ell(ax, y, z, [0.34, 0.04, 0.6], [0.32, 0.4, 0.38]), 0.1); // frontal
  h = smin(h, ell(ax, y, z, [0.3, 0.06, -0.66], [0.28, 0.34, 0.32]), 0.1); // occipital
  // Temporal lobe: hangs low and lateral, with a notch (Sylvian fissure) between it and the frontal/parietal lobes.
  const temporal = ell(ax, y, z, [0.5, -0.31, 0.1], [0.3, 0.22, 0.48]);
  h = smin(h, temporal, 0.03);
  h = Math.max(h, 0.045 - capsule(ax, y, z, [0.92, -0.17, 0.5], [0.7, 0.12, -0.35], 0.0) * 1.0);
  // Deep longitudinal fissure: carve a slab down the middle of the cerebrum, not through the cerebellum.
  const fissure = Math.max(ax - 0.06, -(y + 0.14));
  h = Math.max(h, -fissure);
  // Gyri and sulci: winding grooves that only cut a thin layer near the surface.
  const groove = 1 - Math.min(1, Math.abs(noise3(x * 6, y * 6 + 3, z * 6)) / 0.2);
  h += 0.09 * groove * groove;
  // Cerebellum low at the back (horizontal folia), brainstem below.
  const cerebellum = ell(x, y, z, [0, -0.42, -0.64], [0.46, 0.18, 0.28]) + 0.012 * Math.sin(y * 70);
  let d = smin(h, cerebellum, 0.03);
  d = smin(d, capsule(x, y, z, [0, -0.4, 0.0], [0, -0.9, -0.2], 0.12), 0.06);
  return d;
}

/** Notes sit in the cortex (a shell below the surface), so folds, lobes and the fissure read from every angle. */
const CORTEX = 0.2;
const brainCortex: Inside = (x, y, z) => {
  const d = brainSdf(x, y, z);
  return d <= 0 && d >= -CORTEX;
};

// ---------------------------------------------------------------- shape library

const PHI = (1 + Math.sqrt(5)) / 2;
const ICO: Vec3[] = (
  [[-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0], [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI], [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]] as Vec3[]
).map(([a, b, c]) => {
  const m = Math.hypot(a, b, c);
  return [a / m, b / m, c / m] as Vec3;
});

interface ShapeDef {
  inside: Inside;
  /** Sampling box [min, max] per axis. */
  min: Vec3;
  max: Vec3;
  /** A point guaranteed inside the shape. */
  anchor: Vec3;
}

const box = (e: number): { min: Vec3; max: Vec3 } => ({ min: [-e, -e, -e], max: [e, e, e] });

const SHAPE_DEFS: Record<Exclude<ShapeId, "default">, ShapeDef> = {
  sphere: { inside: (x, y, z) => x * x + y * y + z * z <= 1, ...box(1), anchor: [0, 0, 0] },
  cube: { inside: (x, y, z) => Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) <= 0.74, ...box(0.74), anchor: [0, 0, 0] },
  diamond: { inside: (x, y, z) => Math.abs(x) / 0.78 + Math.abs(y) / 1.2 + Math.abs(z) / 0.78 <= 1, min: [-0.78, -1.2, -0.78], max: [0.78, 1.2, 0.78], anchor: [0, 0, 0] },
  pyramid: {
    inside: (x, y, z) => {
      const n = (y + 0.75) / 1.7;
      if (n < 0 || n > 1) return false;
      const i = 1 - n;
      return Math.abs(x) <= i && Math.abs(z) <= i;
    },
    min: [-1, -0.75, -1],
    max: [1, 0.95, 1],
    anchor: [0, -0.5, 0],
  },
  star: {
    inside: (x, y, z) => {
      const n = Math.hypot(x, y, z);
      if (n < 1e-6) return true;
      let best = -1;
      for (const [a, b, c] of ICO) best = Math.max(best, (a * x + b * y + c * z) / n);
      const r = Math.max(0, (best - 0.79) / 0.21);
      return n <= 0.36 + 0.8 * Math.pow(r, 1.6);
    },
    ...box(1.16),
    anchor: [0, 0, 0],
  },
  heart: {
    inside: (x, y, z) => {
      const a = x * 1.15, b = y * 1.15 + 0.1, c = z * 1.15;
      const t = a * a + 2.25 * c * c + b * b - 1;
      return t * t * t - a * a * b * b * b - 0.1125 * c * c * b * b * b <= 0;
    },
    min: [-1, -1, -0.7],
    max: [1, 0.95, 0.7],
    anchor: [0, 0, 0],
  },
  ring: {
    inside: (x, y, z) => (Math.hypot(x, z) - 0.74) ** 2 + y * y <= 0.34 * 0.34,
    min: [-1.1, -0.34, -1.1],
    max: [1.1, 0.34, 1.1],
    anchor: [0.74, 0, 0],
  },
  helix: {
    inside: (x, y, z) => {
      if (Math.abs(y) > 1.15) return false;
      const a = ((y + 1.15) / 2.3) * Math.PI * 2 * 2.5;
      const d1 = Math.hypot(x - 0.42 * Math.cos(a), z - 0.42 * Math.sin(a));
      const d2 = Math.hypot(x + 0.42 * Math.cos(a), z + 0.42 * Math.sin(a));
      return Math.min(d1, d2) <= 0.14;
    },
    min: [-0.6, -1.15, -0.6],
    max: [0.6, 1.15, 0.6],
    anchor: [0.42, -1.15, 0],
  },
  galaxy: {
    inside: (x, y, z) => {
      const r = Math.hypot(x, z);
      if (r > 1.1) return false;
      const thick = r < 0.25 ? 0.3 * (1 - r / 0.25) + 0.07 : 0.07 * (1.2 - r * 0.6);
      if (Math.abs(y) > thick) return false;
      if (r < 0.25) return true;
      return Math.cos(2 * (Math.atan2(z, x) - 3.4 * r)) > 0.15;
    },
    min: [-1.1, -0.37, -1.1],
    max: [1.1, 0.37, 1.1],
    anchor: [0, 0, 0],
  },
  brain: { inside: brainCortex, min: [-0.95, -1.05, -1.05], max: [0.95, 0.72, 1.05], anchor: [0.4, 0.1, 0] },
};

// ---------------------------------------------------------------- deterministic helpers

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_TRIES = 4000;

function sampleIn(def: ShapeDef, ok: Inside, rand: () => number, fallback: Vec3 = def.anchor): Vec3 {
  for (let k = 0; k < MAX_TRIES; k++) {
    const x = def.min[0] + rand() * (def.max[0] - def.min[0]);
    const y = def.min[1] + rand() * (def.max[1] - def.min[1]);
    const z = def.min[2] + rand() * (def.max[2] - def.min[2]);
    if (ok(x, y, z)) return [x, y, z];
  }
  return fallback;
}

const volumeCache = new Map<ShapeId, number>();

/** Monte Carlo volume of the shape in unit coordinates (deterministic). */
function shapeVolume(id: Exclude<ShapeId, "default">): number {
  const hit = volumeCache.get(id);
  if (hit !== undefined) return hit;
  const def = SHAPE_DEFS[id];
  const rand = rng(7);
  let inside = 0;
  const N = 6000;
  for (let i = 0; i < N; i++) {
    if (def.inside(def.min[0] + rand() * (def.max[0] - def.min[0]), def.min[1] + rand() * (def.max[1] - def.min[1]), def.min[2] + rand() * (def.max[2] - def.min[2]))) inside++;
  }
  const box = (def.max[0] - def.min[0]) * (def.max[1] - def.min[1]) * (def.max[2] - def.min[2]);
  const v = Math.max(0.02, (inside / N) * box);
  volumeCache.set(id, v);
  return v;
}

const LINK = 6;

/** Unit coordinates to world units: the shape's volume holds about one note per LINK^3. */
export function worldScale(id: ShapeId, noteCount: number): number {
  if (id === "default") return 1;
  return Math.max(14, Math.cbrt(Math.max(noteCount, 1) / shapeVolume(id)) * LINK);
}

// ---------------------------------------------------------------- folder regions (brain only)

export const OTHER_SLOT = 8;
export const MAX_FOLDER_REGIONS = 8;

/** Region slots on the brain, in the order they are handed out (front and back first, so few folders split cleanly). */
const SLOT_ANCHORS: readonly Vec3[] = [
  [0.4, 0.1, 0.62], // frontal right
  [-0.34, 0.12, -0.62], // occipital left
  [-0.4, 0.1, 0.62], // frontal left
  [0.34, 0.12, -0.62], // occipital right
  [0.52, -0.3, 0.12], // temporal right
  [-0.4, 0.4, -0.05], // parietal left
  [-0.52, -0.3, 0.12], // temporal left
  [0.4, 0.4, -0.05], // parietal right
  [0, -0.52, -0.7], // other: cerebellum
];
const ROOT_ANCHOR: Vec3 = [0, -0.78, -0.12];
const SLOT_NAMES = ["frontal right", "occipital left", "frontal left", "occipital right", "temporal right", "parietal left", "temporal left", "parietal right", "other"];

/** Persisted by the scene next to the position cache: folder to region slot, and each slot's size weight (frozen when assigned). */
export interface ShapeCache {
  slots: Map<string, number>;
  weights: Map<number, number>;
}

export const newShapeCache = (): ShapeCache => ({ slots: new Map(), weights: new Map() });

export interface RegionInfo {
  /** `root`, `other` or `folder:<name>`. */
  id: string;
  label: string;
  slot: number; // -1 for the root region
  folders: string[];
  count: number;
}

/** Top-level folder name of a node path, or `ROOT_FOLDER` for notes in the vault root. */
export function topFolder(path: string): string {
  if (path === ROOT_FOLDER) return ROOT_FOLDER;
  const i = path.indexOf("/");
  return i < 0 ? ROOT_FOLDER : path.slice(0, i);
}

/** Assigns folders to region slots (mutating `cache`; existing assignments never move) and returns the active regions. */
export function assignRegions(graph: BrainGraph, cache: ShapeCache): RegionInfo[] {
  const counts = new Map<string, number>();
  graph.paths.forEach((p, i) => {
    const f = topFolder(p);
    counts.set(f, (counts.get(f) ?? 0) + (graph.kinds[i] === "folder" ? 0 : 1));
  });
  // Folder nodes only count toward a folder that has notes; a folder that exists only as a node still needs a region.
  graph.paths.forEach((p, i) => {
    if (graph.kinds[i] === "folder") {
      const f = topFolder(p);
      if (!counts.has(f)) counts.set(f, 0);
    }
  });
  const names = [...counts.keys()].filter((f) => f !== ROOT_FOLDER);
  for (const f of [...cache.slots.keys()]) if (!counts.has(f)) cache.slots.delete(f);
  const used = new Set(cache.slots.values());
  for (const s of [...cache.weights.keys()]) if (!used.has(s)) cache.weights.delete(s);
  const fresh = names.filter((f) => !cache.slots.has(f)).sort((a, b) => counts.get(b)! - counts.get(a)! || (a < b ? -1 : 1));
  for (const f of fresh) {
    let slot = -1;
    for (let s = 0; s < MAX_FOLDER_REGIONS; s++) {
      if (!used.has(s)) {
        slot = s;
        break;
      }
    }
    if (slot < 0) slot = OTHER_SLOT;
    cache.slots.set(f, slot);
    used.add(slot);
    if (slot !== OTHER_SLOT) cache.weights.set(slot, Math.max(1, counts.get(f)!));
  }
  if (used.has(OTHER_SLOT) && !cache.weights.has(OTHER_SLOT)) {
    let sum = 0;
    for (const [f, s] of cache.slots) if (s === OTHER_SLOT) sum += counts.get(f)!;
    cache.weights.set(OTHER_SLOT, Math.max(1, sum));
  }
  const out: RegionInfo[] = [];
  for (let s = 0; s <= OTHER_SLOT; s++) {
    if (!used.has(s)) continue;
    const folders = [...cache.slots].filter(([, v]) => v === s).map(([f]) => f).sort();
    const count = folders.reduce((a, f) => a + counts.get(f)!, 0);
    out.push({ id: s === OTHER_SLOT ? "other" : `folder:${folders[0]!}`, label: s === OTHER_SLOT ? "other" : folders[0]!, slot: s, folders, count });
  }
  const rootCount = counts.get(ROOT_FOLDER);
  if (rootCount !== undefined) out.push({ id: "root", label: "root", slot: -1, folders: [ROOT_FOLDER], count: rootCount });
  return out;
}

interface Region {
  info: RegionInfo;
  anchor: Vec3;
  w: number;
}

/** Weighted nearest anchor (bigger weight claims more volume). */
function regionAt(regions: readonly Region[], x: number, y: number, z: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let r = 0; r < regions.length; r++) {
    const a = regions[r]!.anchor;
    const d = Math.hypot(x - a[0], y - a[1], z - a[2]) / regions[r]!.w;
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

function buildRegions(graph: BrainGraph, cache: ShapeCache): Region[] {
  const infos = assignRegions(graph, cache);
  const raw = infos.map((i) => (i.slot < 0 ? Math.max(1, i.count) : cache.weights.get(i.slot) ?? 1));
  const max = Math.max(...raw, 1);
  return infos.map((info, k) => ({
    info,
    anchor: info.slot < 0 ? ROOT_ANCHOR : SLOT_ANCHORS[info.slot]!,
    // Volume grows with the weight, so distance scales by weight^(1/3); the floor keeps small folders visible.
    w: Math.cbrt(Math.max(0.12, raw[k]! / max)),
  }));
}

// ---------------------------------------------------------------- public interface

export interface RegionAnchor {
  id: string;
  label: string;
  /** World-space label position, inside the region. */
  position: [number, number, number];
  count: number;
}

/** Region label anchors in world units (brain shape only; other shapes have no regions). */
export function regionAnchors(shapeId: ShapeId, graph: BrainGraph, cache: ShapeCache): RegionAnchor[] {
  if (shapeId !== "brain") return [];
  const regions = buildRegions(graph, cache);
  const scale = worldScale("brain", graph.paths.length);
  const def = SHAPE_DEFS.brain;
  const rand = rng(11);
  const pts: Vec3[][] = regions.map(() => []);
  for (let k = 0; k < 4000; k++) {
    const p = sampleIn(def, brainCortex, rand);
    const r = regionAt(regions, p[0], p[1], p[2]);
    if (pts[r]!.length < 400) pts[r]!.push(p);
  }
  return regions.map((reg, r) => {
    const list = pts[r]!.length > 0 ? pts[r]! : [reg.anchor];
    let cx = 0, cy = 0, cz = 0;
    for (const p of list) {
      cx += p[0];
      cy += p[1];
      cz += p[2];
    }
    cx /= list.length;
    cy /= list.length;
    cz /= list.length;
    let best = list[0]!;
    let bd = Infinity;
    for (const p of list) {
      const d = Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return { id: reg.info.id, label: reg.info.label, position: [best[0] * scale, best[1] * scale, best[2] * scale], count: reg.info.count };
  });
}

/** Region id for every node of the graph (brain shape), index-aligned with `graph.paths`. */
export function regionOf(graph: BrainGraph, cache: ShapeCache): string[] {
  const infos = assignRegions(graph, cache);
  const byFolder = new Map<string, string>();
  for (const info of infos) for (const f of info.folders) byFolder.set(f, info.id);
  return graph.paths.map((p) => byFolder.get(topFolder(p)) ?? "root");
}

/**
 * World-space positions (x,y,z triples, index-aligned with `graph.paths`) for the shape. `default` is the plain force
 * layout; every other shape holds the force layout inside the shape's volume (brain: inside each folder's region).
 * `cache` is only used and updated for the brain shape.
 */
export function shapeTargets(shapeId: ShapeId, graph: BrainGraph, cache: ShapeCache): Float32Array {
  const n = graph.paths.length;
  if (shapeId === "default") return forceLayout(n, graph.edges, { seed: 1 });
  const def = SHAPE_DEFS[shapeId];
  const scale = worldScale(shapeId, n);
  const out = new Float32Array(n * 3);
  const iterations = n > 600 ? 70 : 110;

  const place = (members: number[], inside: Inside, seed: number, center: Vec3, start: Vec3 = def.anchor): void => {
    if (members.length === 0) return;
    const local = new Map(members.map((g, l) => [g, l] as const));
    const edges: [number, number][] = [];
    for (const [a, b] of graph.edges) {
      const la = local.get(a);
      const lb = local.get(b);
      if (la !== undefined && lb !== undefined) edges.push([la, lb]);
    }
    const ok = (x: number, y: number, z: number): boolean => inside(x / scale, y / scale, z / scale);
    const rand = rng(seed);
    const pos = forceLayout(members.length, edges, {
      seed,
      iterations,
      linkLength: LINK,
      center: [center[0] * scale, center[1] * scale, center[2] * scale],
      initial: () => {
        const p = sampleIn(def, inside, rand, start);
        return [p[0] * scale, p[1] * scale, p[2] * scale];
      },
      accept: (_i, x, y, z) => ok(x, y, z),
    });
    members.forEach((g, l) => out.set(pos.subarray(l * 3, l * 3 + 3), g * 3));
  };

  if (shapeId !== "brain") {
    place(Array.from({ length: n }, (_, i) => i), def.inside, 1, def.anchor);
    return out;
  }
  const regions = buildRegions(graph, cache);
  const ids = regionOf(graph, cache);
  regions.forEach((reg, r) => {
    const members: number[] = [];
    ids.forEach((id, i) => {
      if (id === reg.info.id) members.push(i);
    });
    place(members, (x, y, z) => brainCortex(x, y, z) && regionAt(regions, x, y, z) === r, 101 + r, reg.anchor, reg.anchor);
  });
  return out;
}

/** Whether a unit-coordinate point lies inside the shape's placement volume (`default` has none). */
export function shapeContains(shapeId: ShapeId, x: number, y: number, z: number): boolean {
  return shapeId === "default" ? true : SHAPE_DEFS[shapeId].inside(x, y, z);
}

/** Names for the brain's region slots (for docs and debugging). */
export const REGION_SLOT_NAMES = SLOT_NAMES;
