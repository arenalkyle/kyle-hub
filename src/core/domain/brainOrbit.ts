/** Pure orbit maths for the brain's agents (no WebGL). Adapted from Hivemynd's orbitAt / orbitSpeed / rebuildOrbitLines. */

import type { OrbitMode } from "./brainMenu";

export type { OrbitMode };
/** Points per orbit line ring (closed: first and last coincide). */
export const ORBIT_LINE_POINTS = 129;

export type Vec3 = [number, number, number];

const GOLDEN = 2.399963229728653;
const TAU = Math.PI * 2;

/** Angular speed in rad/s of the agent in `slot`; solar rings get slower outwards. */
export function orbitSpeed(mode: OrbitMode, slot: number): number {
  if (mode === "solar") return 0.09 / Math.pow(1.25 + 0.32 * slot, 1.5);
  if (mode === "atom") return 0.25 + 0.04 * slot;
  if (mode === "drift") return 0.025;
  return 0;
}

/** Seconds for one full lap (Infinity for `still`). */
export const orbitPeriod = (mode: OrbitMode, slot: number): number => {
  const s = orbitSpeed(mode, slot);
  return s > 0 ? TAU / s : Infinity;
};

/** Radius of the ring for `slot` given the graph radius (about 1.3x, outside the brain). */
export function orbitRadius(mode: OrbitMode, slot: number, graphRadius: number): number {
  if (mode === "solar") return graphRadius * (1.25 + 0.32 * slot);
  if (mode === "atom") return graphRadius * 1.45;
  return graphRadius * 1.3;
}

/** Position (graph centred on the origin) of the agent in a stable `slot` at scene time `time` seconds. */
export function orbitPosition(mode: OrbitMode, slot: number, time: number, graphRadius: number): Vec3 {
  const phase = slot * GOLDEN;
  const r = orbitRadius(mode, slot, graphRadius);
  switch (mode) {
    case "solar": {
      const a = phase + time * orbitSpeed(mode, slot);
      const tilt = ((slot * 0.37) % 0.5) - 0.25;
      const u = Math.cos(a) * r, d = Math.sin(a) * r;
      return [u, -d * Math.sin(tilt), d * Math.cos(tilt)];
    }
    case "atom": {
      const a = time * orbitSpeed(mode, slot) + slot * 1.7;
      const yaw = slot * 0.61;
      const tilt = 1.05;
      const u = Math.cos(a) * r, g = Math.sin(a) * r;
      const y = -g * Math.sin(tilt), z = g * Math.cos(tilt);
      return [u * Math.cos(yaw) + z * Math.sin(yaw), y, -u * Math.sin(yaw) + z * Math.cos(yaw)];
    }
    case "still":
      return [Math.cos(phase) * r, 0, Math.sin(phase) * r];
    default: {
      const a = phase + time * orbitSpeed("drift", slot);
      return [Math.cos(a) * r, Math.sin(a * 2 + phase) * graphRadius * 0.12, Math.sin(a) * r];
    }
  }
}

/** Closed ring for the orbit line of `slot` (solar and atom only; empty otherwise), `ORBIT_LINE_POINTS` xyz triples. */
export function orbitPath(mode: OrbitMode, slot: number, graphRadius: number): Float32Array {
  if (mode !== "solar" && mode !== "atom") return new Float32Array(0);
  const out = new Float32Array(ORBIT_LINE_POINTS * 3);
  const period = orbitPeriod(mode, slot);
  for (let i = 0; i < ORBIT_LINE_POINTS; i++) {
    const p = orbitPosition(mode, slot, (i / (ORBIT_LINE_POINTS - 1)) * period, graphRadius);
    out[i * 3] = p[0];
    out[i * 3 + 1] = p[1];
    out[i * 3 + 2] = p[2];
  }
  return out;
}

/** Sub-agent moon around its parent's current position; `moonSlot` keeps siblings apart. */
export function moonPosition(parent: Vec3, moonSlot: number, time: number, graphRadius: number): Vec3 {
  const r = Math.max(2, graphRadius * 0.07) * (1 + 0.35 * moonSlot);
  const a = time * (1.4 - 0.15 * Math.min(moonSlot, 4)) + moonSlot * GOLDEN;
  const tilt = 0.5 + moonSlot * 0.7;
  const u = Math.cos(a) * r, g = Math.sin(a) * r;
  return [parent[0] + u, parent[1] + g * Math.sin(tilt), parent[2] + g * Math.cos(tilt)];
}
