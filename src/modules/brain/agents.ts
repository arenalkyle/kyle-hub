import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, LineSegments, Points, ShaderMaterial, Vector3,
  type PerspectiveCamera, type Scene,
} from "three";
import type { BrainAccessEvent } from "../../core";
import {
  agentAlpha, applyAccess, endSession, pruneAgents, startSession, tethers, type Agents, type IdentityLookup,
} from "../../core/domain/brainAgents";

const MAX_AGENTS = 48;
const MAX_FLASHES = 64;
const TRAIL_POINTS = 14;
const TRAIL_SAMPLE_MS = 60;
const FLASH_DELAY_MS = 350;
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

interface Flight {
  p: Vector3;
  trail: Vector3[];
  lastSample: number;
  visits: number;
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
  /** Rough radius of the graph, used to place agents that have not visited a note yet. */
  radius(): number;
  identity: IdentityLookup;
}

/** Claude sessions and sub-agents as glowing points that fly between notes. State comes from the pure reducer in core. */
export class AgentLayer {
  private agents: Agents = new Map();
  private readonly flights = new Map<string, Flight>();
  private flashes: Flash[] = [];
  private readonly pointMat = material(POINT_VS, POINT_FS);
  private readonly flashMat = material(POINT_VS, POINT_FS);
  private readonly lineMat = material(LINE_VS, LINE_FS);
  private readonly points = new Points(buffers(MAX_AGENTS, 1, true), this.pointMat);
  private readonly flashPoints = new Points(buffers(MAX_FLASHES, 1, true), this.flashMat);
  private readonly trails = new LineSegments(buffers(MAX_AGENTS, TRAIL_POINTS * 2, false), this.lineMat);
  private readonly tether = new LineSegments(buffers(MAX_AGENTS, 2, false), this.lineMat);
  private lastT = 0;
  private readonly tmp = new Vector3();

  constructor(private readonly scene: Scene, private readonly host: AgentLayerHost) {
    for (const o of [this.trails, this.tether, this.points, this.flashPoints]) {
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
  }

  session(kind: "started" | "ended", sessionId: string): void {
    this.agents = kind === "started" ? startSession(this.agents, sessionId, Date.now(), this.host.identity) : endSession(this.agents, sessionId);
  }

  /** Advances flights and rewrites the GPU buffers; `t` is scene time in seconds. */
  frame(t: number): void {
    const now = Date.now();
    const dt = this.lastT === 0 ? 0.016 : Math.min(t - this.lastT, 0.25);
    this.lastT = t;
    this.agents = pruneAgents(this.agents, now);
    for (const id of this.flights.keys()) if (!this.agents.has(id)) this.flights.delete(id);

    const pos = this.points.geometry.getAttribute("position") as BufferAttribute;
    const col = this.points.geometry.getAttribute("aColor") as BufferAttribute;
    const size = this.points.geometry.getAttribute("aSize") as BufferAttribute;
    const trailPos = this.trails.geometry.getAttribute("position") as BufferAttribute;
    const trailCol = this.trails.geometry.getAttribute("aColor") as BufferAttribute;
    const ease = 1 - Math.exp(-dt * 3);
    const color = new Color();
    let n = 0;
    let tn = 0;
    for (const a of this.agents.values()) {
      if (n >= MAX_AGENTS) break;
      let f = this.flights.get(a.id);
      const rest = a.note ? this.host.notePos(a.note) : undefined;
      const target = rest ? drift(rest, t, new Vector3()) : undefined;
      if (!f) {
        const start = target ? target.clone().add(this.spawnOffset(a.id)) : this.spawnOffset(a.id).multiplyScalar(0.5);
        f = { p: start, trail: [], lastSample: 0, visits: a.visits };
        this.flights.set(a.id, f);
      }
      if (target) f.p.lerp(target, ease);
      if (a.visits !== f.visits) {
        f.visits = a.visits;
        if (rest && a.noteKind) this.flashes.push({ at: drift(rest, t, new Vector3()), color: new Color(a.color), born: now + FLASH_DELAY_MS, strength: a.noteKind });
      }
      if (now - f.lastSample >= TRAIL_SAMPLE_MS) {
        f.lastSample = now;
        f.trail.push(f.p.clone());
        if (f.trail.length > TRAIL_POINTS) f.trail.shift();
      }
      const alpha = agentAlpha(a, now);
      color.set(a.color);
      pos.setXYZ(n, f.p.x, f.p.y, f.p.z);
      col.setXYZW(n, color.r * 1.6, color.g * 1.6, color.b * 1.6, alpha);
      size.setX(n, a.parentId ? 2.2 : 3);
      n++;

      // Trail: fading segments, newest brightest.
      const pts = [...f.trail, f.p];
      for (let i = 1; i < pts.length && tn < MAX_AGENTS * TRAIL_POINTS; i++) {
        const k = i / pts.length;
        const p0 = pts[i - 1]!, p1 = pts[i]!;
        trailPos.setXYZ(tn * 2, p0.x, p0.y, p0.z);
        trailPos.setXYZ(tn * 2 + 1, p1.x, p1.y, p1.z);
        trailCol.setXYZW(tn * 2, color.r, color.g, color.b, alpha * k * k * 0.5);
        trailCol.setXYZW(tn * 2 + 1, color.r, color.g, color.b, alpha * k * 0.5);
        tn++;
      }
    }
    this.points.geometry.setDrawRange(0, n);
    pos.needsUpdate = col.needsUpdate = size.needsUpdate = true;
    this.trails.geometry.setDrawRange(0, tn * 2);
    trailPos.needsUpdate = trailCol.needsUpdate = true;

    // Tethers: sub-agent to parent while both are active.
    const tp = this.tether.geometry.getAttribute("position") as BufferAttribute;
    const tc = this.tether.geometry.getAttribute("aColor") as BufferAttribute;
    let tv = 0;
    for (const [childId, parentId] of tethers(this.agents, now)) {
      const c = this.flights.get(childId), p = this.flights.get(parentId), child = this.agents.get(childId);
      if (!c || !p || !child || tv >= MAX_AGENTS) continue;
      color.set(child.color);
      tp.setXYZ(tv * 2, c.p.x, c.p.y, c.p.z);
      tp.setXYZ(tv * 2 + 1, p.p.x, p.p.y, p.p.z);
      tc.setXYZW(tv * 2, color.r, color.g, color.b, 0.55);
      tc.setXYZW(tv * 2 + 1, color.r, color.g, color.b, 0.55);
      tv++;
    }
    this.tether.geometry.setDrawRange(0, tv * 2);
    tp.needsUpdate = tc.needsUpdate = true;

    // Note flashes: a read flashes, a write pulses bigger and longer.
    this.flashes = this.flashes.filter((f) => now - f.born < FLASH_MS[f.strength]).slice(-MAX_FLASHES);
    const fp = this.flashPoints.geometry.getAttribute("position") as BufferAttribute;
    const fc = this.flashPoints.geometry.getAttribute("aColor") as BufferAttribute;
    const fs = this.flashPoints.geometry.getAttribute("aSize") as BufferAttribute;
    let fn = 0;
    for (const f of this.flashes) {
      const age = now - f.born;
      if (age < 0) continue;
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
      const f = this.flights.get(a.id);
      if (!f) continue;
      this.tmp.copy(f.p).project(camera);
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

  dispose(): void {
    for (const o of [this.trails, this.tether, this.points, this.flashPoints]) {
      this.scene.remove(o);
      o.geometry.dispose();
    }
    for (const m of [this.pointMat, this.flashMat, this.lineMat]) m.dispose();
  }

  private spawnOffset(id: string): Vector3 {
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
    const u = ((h >>> 0) % 1000) / 500 - 1;
    const th = ((((h >>> 10) >>> 0) % 1000) / 1000) * Math.PI * 2;
    const sq = Math.sqrt(1 - u * u);
    const r = Math.max(10, this.host.radius() * 0.5);
    return new Vector3(r * sq * Math.cos(th), r * sq * Math.sin(th), r * u);
  }
}
