/** Simple 3D force layout: fixed iterations, deterministic, then frozen. Pure; positions are x,y,z triples in a flat array. */
export interface LayoutOptions {
  iterations?: number;
  seed?: number;
  /** Known positions by node index (cached); these nodes are not moved. */
  fixed?: ReadonlyMap<number, readonly [number, number, number]>;
  /** Target spring length. */
  linkLength?: number;
  /** Start position for a free node (default: random inside a sphere). Must be a valid position for `accept`. */
  initial?: (i: number, rand: () => number) => readonly [number, number, number];
  /** Volume constraint: a move to (x, y, z) is backed off (halved up to 4 times, then dropped) until this returns true. */
  accept?: (i: number, x: number, y: number, z: number) => boolean;
  /** Point the weak gravity pulls toward (default: origin). */
  center?: readonly [number, number, number];
}

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

/** Exact repulsion up to this many nodes; above it each node samples a fixed number of partners per step. */
const EXACT_LIMIT = 300;
const SAMPLES = 48;

export function forceLayout(n: number, edges: readonly (readonly [number, number])[], opts: LayoutOptions = {}): Float32Array {
  const iterations = opts.iterations ?? 120;
  const L = opts.linkLength ?? 6;
  const rand = rng(opts.seed ?? 1);
  const pos = new Float32Array(n * 3);
  const radius = Math.cbrt(Math.max(n, 1)) * L * 0.8;
  const pinned = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const f = opts.fixed?.get(i);
    if (f) {
      pos.set(f, i * 3);
      pinned[i] = 1;
      continue;
    }
    const init = opts.initial?.(i, rand);
    if (init) {
      pos.set(init, i * 3);
      continue;
    }
    const u = rand() * 2 - 1;
    const th = rand() * Math.PI * 2;
    const r = radius * Math.cbrt(rand());
    const s = Math.sqrt(1 - u * u);
    pos[i * 3] = r * s * Math.cos(th);
    pos[i * 3 + 1] = r * s * Math.sin(th);
    pos[i * 3 + 2] = r * u;
  }
  if (n < 2) return pos;
  const force = new Float32Array(n * 3);
  const k2 = L * L;
  const repel = (i: number, j: number, scale: number): void => {
    let dx = pos[i * 3]! - pos[j * 3]!;
    let dy = pos[i * 3 + 1]! - pos[j * 3 + 1]!;
    let dz = pos[i * 3 + 2]! - pos[j * 3 + 2]!;
    let d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < 0.01) {
      dx = rand() - 0.5;
      dy = rand() - 0.5;
      dz = rand() - 0.5;
      d2 = dx * dx + dy * dy + dz * dz + 0.01;
    }
    const f = (k2 / d2) * scale;
    force[i * 3] = force[i * 3]! + dx * f;
    force[i * 3 + 1] = force[i * 3 + 1]! + dy * f;
    force[i * 3 + 2] = force[i * 3 + 2]! + dz * f;
  };
  for (let it = 0; it < iterations; it++) {
    force.fill(0);
    if (n <= EXACT_LIMIT) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          repel(i, j, 1);
          repel(j, i, 1);
        }
      }
    } else {
      const scale = (n - 1) / SAMPLES;
      for (let i = 0; i < n; i++) {
        for (let s = 0; s < SAMPLES; s++) {
          const j = Math.floor(rand() * n);
          if (j !== i) repel(i, j, scale);
        }
      }
    }
    for (const [a, b] of edges) {
      const dx = pos[b * 3]! - pos[a * 3]!;
      const dy = pos[b * 3 + 1]! - pos[a * 3 + 1]!;
      const dz = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.001;
      const f = ((d - L) / d) * 0.5;
      force[a * 3] = force[a * 3]! + dx * f;
      force[a * 3 + 1] = force[a * 3 + 1]! + dy * f;
      force[a * 3 + 2] = force[a * 3 + 2]! + dz * f;
      force[b * 3] = force[b * 3]! - dx * f;
      force[b * 3 + 1] = force[b * 3 + 1]! - dy * f;
      force[b * 3 + 2] = force[b * 3 + 2]! - dz * f;
    }
    const cool = 1 - it / iterations;
    const maxStep = L * 0.6 * cool + 0.05;
    for (let i = 0; i < n; i++) {
      if (pinned[i]) continue;
      const o = i * 3;
      const d: [number, number, number] = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        // Gravity toward the centre keeps disconnected components together.
        const f = (force[o + c]! - (pos[o + c]! - (opts.center?.[c] ?? 0)) * 0.02) * 0.3;
        d[c] = Math.max(-maxStep, Math.min(maxStep, f));
      }
      let t = 1;
      if (opts.accept) {
        for (let b = 0; b < 4 && !opts.accept(i, pos[o]! + d[0] * t, pos[o + 1]! + d[1] * t, pos[o + 2]! + d[2] * t); b++) t = b === 3 ? 0 : t / 2;
      }
      for (let c = 0; c < 3; c++) pos[o + c] = pos[o + c]! + d[c]! * t;
    }
  }
  return pos;
}
