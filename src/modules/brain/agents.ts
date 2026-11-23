import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, LineSegments, Points, ShaderMaterial, Vector3,
  type PerspectiveCamera, type Scene,
} from "three";
import type { BrainAccessEvent } from "../../core";
import {
  applyAccess, endSession, endSubagent, pruneAgents, startSession, startSubagent, zapOf, type Agent, type Agents, type IdentityLookup,
} from "../../core/domain/brainAgents";
import { tagNames } from "../../core/domain/brainTags";
import { moonPosition, orbitPath, orbitPosition, ORBIT_LINE_POINTS, type OrbitMode } from "../../core/domain/brainOrbit";

const MAX_SESSIONS = 24;
const MAX_AGENTS = 48;
const MAX_FLASHES = 64;
const MAX_ZAPS = 32;
const ZAP_MS = 400;
const ZAP_SEGMENTS = 12;
const ZAP_STRANDS_MAX = 3;
const RING_SEGMENTS = ORBIT_LINE_POINTS - 1;
const FLASH_MS = { read: 900, write: 1800 } as const;
const HOVER_PX = 14;

const POINT_VS = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
uniform float uScale;
varying vec4 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.1), 2.0, 160.0);
  gl_Position = projectionMatrix * mv;
  vColor = aColor;
}`;
const POINT_FS = /* glsl */ `
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = smoothstep(1.0, 0.0, d);
  gl_FragColor = vec4(vColor.rgb * (0.6 + a), a * a * vColor.a);
}`;
const LINE_VS = /* glsl */ `
attribute vec4 aColor;
varying vec4 vColor;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vColor = aColor;
}`;
const LINE_FS = /* glsl */ `
varying vec4 vColor;
void main() { gl_FragColor = vColor; }`;

const material = (vs: string, fs: string): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: { uScale: { value: 500 } },
    vertexShader: vs,
    fragmentShader: fs,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });

function buffers(capacity: number, vertsPer: number, sized: boolean): BufferGeometry {
  const g = new BufferGeometry();
  const n = capacity * vertsPer;
  g.setAttribute("position", new BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute("aColor", new BufferAttribute(new Float32Array(n * 4), 4));
  if (sized) g.setAttribute("aSize", new BufferAttribute(new Float32Array(n), 1));
  g.setDrawRange(0, 0);
  return g;
}

/** Same sway as the node and line shaders, so agents sit on the notes they visit. */
export function drift(p: readonly [number, number, number], t: number, out: Vector3): Vector3 {
  return out.set(
    p[0] + 0.55 * Math.sin(t * 0.31 + p[1] * 0.13),
    p[1] + 0.55 * Math.sin(t * 0.27 + p[2] * 0.11),
    p[2] + 0.55 * Math.sin(t * 0.23 + p[0] * 0.12),
  );
}

interface Zap {
  agentId: string;
  path: string;
  kind: "read" | "write";
  born: number;
  flashed: boolean;
}
interface Flash {
  at: Vector3;
  color: Color;
  born: number;
  strength: "read" | "write";
}

export interface AgentLayerHost {
  /** Rest position of a note's node (vault-relative path), if it is in the graph. */
  notePos(path: string): readonly [number, number, number] | undefined;
  /** Radius of the current shape; agents orbit at about 1.3x this. */
  radius(): number;
  identity: IdentityLookup;
}

export interface OrbitOptions {
  mode: OrbitMode;
  /** `default`, `rainbow` or a custom `#rrggbb`. */
  color: string;
  /** Orbit line opacity 0..1. */
  opacity: number;
}

const DEFAULT_ORBIT: OrbitOptions = { mode: "drift", color: "default", opacity: 0.35 };

/**
 * Claude sessions as glowing points orbiting outside the brain for as long as they live, and sub-agents as moons around them.
 * A read or write fires a short jagged zap from the agent to the note. State comes from the pure reducer in core; the layer only
 * reacts to `brain:access` and session start/end events (and is drawn each frame).
 */
export class AgentLayer {
  private agents: Agents = new Map();
  private zaps: Zap[] = [];
  private flashes: Flash[] = [];
  /** Current world position of each agent, for zaps, picking and name tags. */
  private readonly where = new Map<string, Vector3>();
  private readonly paths = new Map<number, Float32Array>();
  private pathsKey = "";
  private ringsKey = "";
  private shownRadius = 0;
  private readonly pointMat = material(POINT_VS, POINT_FS);
  private readonly flashMat = material(POINT_VS, POINT_FS);
  private readonly lineMat = material(LINE_VS, LINE_FS);
  private readonly points = new Points(buffers(MAX_AGENTS, 1, true), this.pointMat);
  private readonly flashPoints = new Points(buffers(MAX_FLASHES, 1, true), this.flashMat);
  private readonly zapLines = new LineSegments(buffers(MAX_ZAPS * ZAP_STRANDS_MAX * ZAP_SEGMENTS, 2, false), this.lineMat);
  private readonly rings = new LineSegments(buffers(MAX_SESSIONS * RING_SEGMENTS, 2, false), this.lineMat);
  private lastT = 0;
  private readonly tmp = new Vector3();

  constructor(private readonly scene: Scene, private readonly host: AgentLayerHost) {
    for (const o of [this.rings, this.zapLines, this.points, this.flashPoints]) {
      o.frustumCulled = false;
      scene.add(o);
    }
  }

  setScale(scale: number): void {
    this.pointMat.uniforms.uScale!.value = scale;
    this.flashMat.uniforms.uScale!.value = scale;
  }

  access(e: BrainAccessEvent): void {
    this.agents = applyAccess(this.agents, e, Date.now(), this.host.identity);
    const z = zapOf(e);
    if (z && this.agents.has(z.agentId)) this.zaps = [...this.zaps, { ...z, born: Date.now(), flashed: false }].slice(-MAX_ZAPS);
  }

  subagent(kind: "started" | "ended", parentId: string, agentId: string, agentType?: string): void {
    this.agents = kind === "started" ? startSubagent(this.agents, parentId, agentId, agentType, Date.now(), this.host.identity) : endSubagent(this.agents, agentId);
  }

  session(kind: "started" | "ended", sessionId: string): void {
    this.agents = kind === "started" ? startSession(this.agents, sessionId, Date.now(), this.host.identity) : endSession(this.agents, sessionId);
  }

  /** Rewrites the GPU buffers; `t` is scene time in seconds. */
  frame(t: number, orbit: OrbitOptions = DEFAULT_ORBIT): void {
    const now = Date.now();
    const dt = this.lastT === 0 ? 0.016 : Math.min(t - this.lastT, 0.25);
    this.lastT = t;
    this.agents = pruneAgents(this.agents, now);
    const target = Math.max(10, this.host.radius());
    this.shownRadius = this.shownRadius === 0 ? target : this.shownRadius + (target - this.shownRadius) * (1 - Math.exp(-dt * 3));
    const R = this.shownRadius;

    // Sessions first (moons follow their parent), then moons.
    this.where.clear();
    const sessions: Agent[] = [], moons: Agent[] = [];
    for (const a of this.agents.values()) (a.parentId ? moons : sessions).push(a);
    for (const a of sessions) {
      const p = orbitPosition(orbit.mode, a.slot, t, R);
      this.where.set(a.id, new Vector3(p[0], p[1], p[2]));
    }
    for (const a of moons) {
      const parent = this.where.get(a.parentId!);
      if (!parent) continue;
      const p = moonPosition([parent.x, parent.y, parent.z], a.slot, t, R);
      this.where.set(a.id, new Vector3(p[0], p[1], p[2]));
    }

    const pos = this.points.geometry.getAttribute("position") as BufferAttribute;
    const col = this.points.geometry.getAttribute("aColor") as BufferAttribute;
    const size = this.points.geometry.getAttribute("aSize") as BufferAttribute;
    const color = new Color();
    let n = 0;
    for (const a of this.agents.values()) {
      const p = this.where.get(a.id);
      if (!p || n >= MAX_AGENTS) continue;
      color.set(a.color);
      pos.setXYZ(n, p.x, p.y, p.z);
      col.setXYZW(n, color.r * 1.6, color.g * 1.6, color.b * 1.6, 1);
      size.setX(n, a.parentId ? 2.2 : 3);
      n++;
    }
    this.points.geometry.setDrawRange(0, n);
    pos.needsUpdate = col.needsUpdate = size.needsUpdate = true;

    this.writeRings(sessions, orbit, t, R);
    this.writeZaps(now, t);
    this.writeFlashes(now);
  }

  /** Orbit lines for solar and atom: one closed ring per live session. */
  private writeRings(sessions: Agent[], orbit: OrbitOptions, t: number, R: number): void {
    const geo = this.rings.geometry;
    const draw = orbit.mode === "solar" || orbit.mode === "atom";
    const live = draw && orbit.opacity > 0 ? sessions.slice(0, MAX_SESSIONS) : [];
    if (live.length === 0) {
      geo.setDrawRange(0, 0);
      this.ringsKey = "";
      return;
    }
    const pathsKey = `${orbit.mode}:${R.toFixed(1)}`;
    if (pathsKey !== this.pathsKey) {
      this.pathsKey = pathsKey;
      this.paths.clear();
    }
    const rainbow = orbit.color === "rainbow";
    const key = `${pathsKey}|${orbit.color}|${orbit.opacity}|${live.map((a) => `${a.slot}${a.color}`).join(",")}`;
    if (!rainbow && key === this.ringsKey) return;
    this.ringsKey = key;
    const pos = geo.getAttribute("position") as BufferAttribute;
    const col = geo.getAttribute("aColor") as BufferAttribute;
    const c = new Color();
    let v = 0;
    for (const a of live) {
      let path = this.paths.get(a.slot);
      if (!path) this.paths.set(a.slot, (path = orbitPath(orbit.mode, a.slot, R)));
      const base = rainbow ? undefined : new Color(orbit.color === "default" ? a.color : orbit.color).multiplyScalar(orbit.color === "default" ? 0.6 : 1);
      for (let i = 0; i < RING_SEGMENTS; i++) {
        for (let k = 0; k < 2; k++) {
          const j = (i + k) * 3;
          pos.setXYZ(v, path[j]!, path[j + 1]!, path[j + 2]!);
          if (base) c.copy(base);
          else c.setHSL(((i + k) / RING_SEGMENTS + t * 0.03 + a.slot * 0.1) % 1, 0.9, 0.5);
          col.setXYZW(v, c.r, c.g, c.b, orbit.opacity);
          v++;
        }
      }
    }
    geo.setDrawRange(0, v);
    pos.needsUpdate = col.needsUpdate = true;
  }

  /** Jagged lightning from each zapping agent to its note; writes use three strands and burn brighter. */
  private writeZaps(now: number, t: number): void {
    this.zaps = this.zaps.filter((z) => now - z.born < ZAP_MS);
    const pos = this.zapLines.geometry.getAttribute("position") as BufferAttribute;
    const col = this.zapLines.geometry.getAttribute("aColor") as BufferAttribute;
    const color = new Color();
    const from = new Vector3(), to = new Vector3(), dir = new Vector3(), u = new Vector3(), w = new Vector3(), p = new Vector3(), prev = new Vector3();
    let v = 0;
    for (const z of this.zaps) {
      const start = this.where.get(z.agentId);
      const rest = this.host.notePos(z.path);
      const agent = this.agents.get(z.agentId);
      if (!start || !rest || !agent) continue;
      from.copy(start);
      drift(rest, t, to);
      if (!z.flashed) {
        z.flashed = true;
        this.flashes.push({ at: to.clone(), color: new Color(agent.color), born: now, strength: z.kind });
      }
      dir.subVectors(to, from);
      const dist = dir.length();
      if (dist < 1e-3) continue;
      dir.divideScalar(dist);
      u.set(0, 1, 0);
      if (Math.abs(dir.y) > 0.9) u.set(1, 0, 0);
      u.cross(dir).normalize();
      w.crossVectors(dir, u);
      const k = (now - z.born) / ZAP_MS;
      const strands = z.kind === "write" ? 3 : 1;
      const bright = z.kind === "write" ? 2.2 : 1.3;
      const alpha = (z.kind === "write" ? 1 : 0.8) * (1 - k * k) * (0.7 + 0.3 * Math.random());
      color.set(agent.color);
      for (let s = 0; s < strands; s++) {
        const spread = s === 0 ? 0 : dist * 0.004 * (s === 1 ? 1 : -1);
        prev.copy(from);
        for (let i = 1; i <= ZAP_SEGMENTS; i++) {
          const f = i / ZAP_SEGMENTS;
          const amp = i === ZAP_SEGMENTS ? 0 : dist * 0.05 * Math.sin(Math.PI * f);
          const a1 = (Math.random() - 0.5) * 2 * amp + spread, a2 = (Math.random() - 0.5) * 2 * amp + spread;
          p.copy(from).addScaledVector(dir, dist * f).addScaledVector(u, a1).addScaledVector(w, a2);
          pos.setXYZ(v, prev.x, prev.y, prev.z);
          pos.setXYZ(v + 1, p.x, p.y, p.z);
          col.setXYZW(v, color.r * bright + 0.25, color.g * bright + 0.25, color.b * bright + 0.25, alpha);
          col.setXYZW(v + 1, color.r * bright + 0.25, color.g * bright + 0.25, color.b * bright + 0.25, alpha);
          prev.copy(p);
          v += 2;
        }
      }
    }
    this.zapLines.geometry.setDrawRange(0, v);
    pos.needsUpdate = col.needsUpdate = true;
  }

  /** Note flashes: a read flashes, a write pulses bigger and longer. */
  private writeFlashes(now: number): void {
    this.flashes = this.flashes.filter((f) => now - f.born < FLASH_MS[f.strength]).slice(-MAX_FLASHES);
    const fp = this.flashPoints.geometry.getAttribute("position") as BufferAttribute;
    const fc = this.flashPoints.geometry.getAttribute("aColor") as BufferAttribute;
    const fs = this.flashPoints.geometry.getAttribute("aSize") as BufferAttribute;
    let fn = 0;
    for (const f of this.flashes) {
      const age = now - f.born;
      const k = age / FLASH_MS[f.strength];
      const boost = f.strength === "write" ? 2 : 1;
      fp.setXYZ(fn, f.at.x, f.at.y, f.at.z);
      fc.setXYZW(fn, f.color.r * 2 + 0.4, f.color.g * 2 + 0.4, f.color.b * 2 + 0.4, (1 - k) * (0.6 + 0.4 * boost));
      fs.setX(fn, (2.5 + 5 * k) * boost);
      fn++;
    }
    this.flashPoints.geometry.setDrawRange(0, fn);
    fp.needsUpdate = fc.needsUpdate = fs.needsUpdate = true;
  }

  /** Nearest agent to a pixel inside the canvas (`x`,`y` relative to it), with its name and current note. */
  pick(x: number, y: number, camera: PerspectiveCamera, width: number, height: number): { name: string; note?: string; x: number; y: number } | undefined {
    let best: { name: string; note?: string; x: number; y: number } | undefined;
    let bestD = HOVER_PX;
    for (const a of this.agents.values()) {
      const at = this.where.get(a.id);
      if (!at) continue;
      this.tmp.copy(at).project(camera);
      if (this.tmp.z > 1) continue;
      const sx = (this.tmp.x * 0.5 + 0.5) * width, sy = (-this.tmp.y * 0.5 + 0.5) * height;
      const d = Math.hypot(sx - x, sy - y);
      if (d < bestD) {
        bestD = d;
        best = { name: a.name, ...(a.note !== undefined ? { note: a.note } : {}), x: sx, y: sy };
      }
    }
    return best;
  }

  /** Name tag text and colour for a session or sub-agent id (the same names the tags use); undefined when it is not live. */
  tagOf(id: string): { name: string; color: string } | undefined {
    const a = this.agents.get(id);
    return a ? { name: tagNames(this.agents).get(id) ?? a.name, color: a.color } : undefined;
  }

  /** Screen positions (pixels inside the canvas) of every agent in front of the camera and on screen, for name tags. */
  labels(camera: PerspectiveCamera, width: number, height: number): { id: string; name: string; color: string; x: number; y: number; moon: boolean }[] {
    const out: { id: string; name: string; color: string; x: number; y: number; moon: boolean }[] = [];
    const names = tagNames(this.agents);
    for (const a of this.agents.values()) {
      const at = this.where.get(a.id);
      if (!at) continue;
      this.tmp.copy(at).project(camera);
      if (this.tmp.z > 1 || Math.abs(this.tmp.x) > 1.05 || Math.abs(this.tmp.y) > 1.05) continue;
      out.push({ id: a.id, name: names.get(a.id) ?? a.name, color: a.color, x: (this.tmp.x * 0.5 + 0.5) * width, y: (-this.tmp.y * 0.5 + 0.5) * height, moon: !!a.parentId });
    }
    return out;
  }

  dispose(): void {
    for (const o of [this.rings, this.zapLines, this.points, this.flashPoints]) {
      this.scene.remove(o);
      o.geometry.dispose();
    }
    for (const m of [this.pointMat, this.flashMat, this.lineMat]) m.dispose();
  }
}
