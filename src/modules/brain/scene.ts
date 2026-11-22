import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  LineSegments,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { BrainHandle } from "../../core";
import { buildGraph, type BrainGraph } from "../../core/domain/brainGraph";
import { countReads, heatOf, type ReadAccess, type ReadCounts } from "../../core/domain/brainHeat";
import { forceLayout } from "../../core/domain/forceLayout";
import { DEFAULT_FPS } from "../../core/domain/fps";

export interface BrainOptions {
  bloom: number;
  nodeSize: number;
}

/** Everything the scene needs from the vault and hub; supplied by the brain module so this file stays UI-only. */
export interface BrainSource {
  /** Markdown note paths with modified times, and the resolved link map. */
  notes(): { path: string; mtime: number }[];
  resolvedLinks(): Record<string, Record<string, number>>;
  /** Cached node positions for this vault; mutated by the scene. */
  layoutCache: Map<string, [number, number, number]>;
  saveLayout(): void;
  /** Read accesses of the last 90 days from the logs service (empty when unavailable). */
  reads(): Promise<ReadAccess[]>;
  options(): BrainOptions;
  fps(): number;
  onFps(cb: (fps: number) => void): () => void;
  /** Note create, rename, delete or link changes. */
  onGraphChange(cb: () => void): () => void;
  /** An agent read or wrote a note (heat may have changed). */
  onHeatDirty(cb: () => void): () => void;
}

const TEAL = new Color(0.1, 0.78, 0.72);
const GOLD = new Color(1.0, 0.76, 0.22);
const HIGHLIGHT = new Color(1, 1, 1);
const HIGHLIGHT_MS = 4000;
const HEAT_REFRESH_MS = 5 * 60_000;

const DRIFT = /* glsl */ `
uniform float uTime;
vec3 drift(vec3 p) {
  return p + 0.55 * vec3(sin(uTime * 0.31 + p.y * 0.13), sin(uTime * 0.27 + p.z * 0.11), sin(uTime * 0.23 + p.x * 0.12));
}`;

const POINT_VS = /* glsl */ `
${DRIFT}
attribute float aSize;
attribute vec3 aColor;
uniform float uScale;
uniform float uSizeMul;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(drift(position), 1.0);
  gl_PointSize = clamp(aSize * uSizeMul * uScale / max(-mv.z, 0.1), 1.0, 256.0);
  gl_Position = projectionMatrix * mv;
  vColor = aColor;
}`;

const POINT_FS = /* glsl */ `
uniform float uAlpha;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = smoothstep(1.0, 0.0, d);
  gl_FragColor = vec4(vColor * (0.5 + a), a * a * uAlpha);
}`;

const LINE_VS = /* glsl */ `
${DRIFT}
attribute vec3 aColor;
varying vec3 vColor;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(drift(position), 1.0);
  vColor = aColor;
}`;

const LINE_FS = /* glsl */ `
uniform float uAlpha;
varying vec3 vColor;
void main() { gl_FragColor = vec4(vColor, uAlpha); }`;

function pointMaterial(uAlpha: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 500 }, uSizeMul: { value: 1 }, uAlpha: { value: uAlpha } },
    vertexShader: POINT_VS,
    fragmentShader: POINT_FS,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

/** Positions for a graph: cached nodes stay put, new ones are laid out around them; the cache is updated. */
export function layoutFor(graph: BrainGraph, cache: Map<string, [number, number, number]>): Float32Array {
  const fixed = new Map<number, [number, number, number]>();
  graph.paths.forEach((p, i) => {
    const c = cache.get(p);
    if (c) fixed.set(i, c);
  });
  const missing = graph.paths.length - fixed.size;
  const pos = missing === 0 ? new Float32Array(graph.paths.length * 3) : forceLayout(graph.paths.length, graph.edges, { fixed, iterations: fixed.size > 0 ? 70 : 140 });
  if (missing === 0) fixed.forEach((v, i) => pos.set(v, i * 3));
  const live = new Set(graph.paths);
  for (const k of [...cache.keys()]) if (!live.has(k)) cache.delete(k);
  graph.paths.forEach((p, i) => cache.set(p, [round1(pos[i * 3]!), round1(pos[i * 3 + 1]!), round1(pos[i * 3 + 2]!)]));
  return pos;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** The 3D brain: one reusable component, mounted by the Command Center and the Brain tab. */
export class BrainScene implements BrainHandle {
  private readonly win: Window;
  private readonly doc: Document;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(55, 1, 0.1, 3000);
  private readonly controls: OrbitControls;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly nodeMat = pointMaterial(1);
  private readonly nebulaMat = pointMaterial(0.07);
  private readonly lineMat: ShaderMaterial;
  private readonly nebula: Points;
  private nodes: Points | undefined;
  private lines: LineSegments | undefined;
  private graph: BrainGraph = { paths: [], edges: [], degree: [] };
  private mtimes: number[] = [];
  private counts = new Map<string, ReadCounts>();
  private baseSize = new Float32Array(0);
  private highlighted: { idx: number; timer: number } | undefined;
  private raf = 0;
  private last = 0;
  private fps: number;
  private intersecting = true;
  private running = false;
  private disposed = false;
  private framed = false;
  private readonly cleanups: (() => void)[] = [];
  private rebuildTimer = 0;
  private heatTimer = 0;
  private empty: HTMLElement;

  constructor(private readonly host: HTMLElement, private readonly src: BrainSource) {
    this.win = host.win ?? window;
    this.doc = host.ownerDocument;
    this.fps = src.fps() || DEFAULT_FPS;
    host.addClass("kh-brain-canvas-host");
    this.renderer = new WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(this.win.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(new Color(0.02, 0.03, 0.07), 1);
    const canvas = this.renderer.domElement;
    canvas.addClass("kh-brain-canvas");
    host.appendChild(canvas);
    this.empty = host.createDiv({ cls: "kh-brain-empty", text: "No notes yet." });
    this.empty.hide();

    this.camera.position.set(0, 0, 60);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotate = false;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 1800;

    this.lineMat = new ShaderMaterial({
      uniforms: { uTime: this.nodeMat.uniforms.uTime!, uAlpha: { value: 0.22 } },
      vertexShader: LINE_VS,
      fragmentShader: LINE_FS,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.nebulaMat.uniforms.uTime = this.nodeMat.uniforms.uTime!;
    this.nebula = this.buildNebula();
    this.scene.add(this.nebula);

    const size = new Vector2(Math.max(host.clientWidth, 1), Math.max(host.clientHeight, 1));
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(size, src.options().bloom, 0.55, 0.12);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(host);
    this.cleanups.push(() => ro.disconnect());
    const io = new IntersectionObserver((e) => {
      this.intersecting = e.some((x) => x.isIntersecting);
      this.syncRunning();
    });
    io.observe(host);
    this.cleanups.push(() => io.disconnect());
    const vis = (): void => this.syncRunning();
    this.doc.addEventListener("visibilitychange", vis);
    this.cleanups.push(() => this.doc.removeEventListener("visibilitychange", vis));
    this.cleanups.push(src.onFps((f) => (this.fps = f || DEFAULT_FPS)));
    this.cleanups.push(src.onGraphChange(() => this.scheduleRebuild()));
    let heatDebounce = 0;
    this.cleanups.push(
      src.onHeatDirty(() => {
        this.win.clearTimeout(heatDebounce);
        heatDebounce = this.win.setTimeout(() => void this.refreshHeat(), 10_000);
      }),
    );
    this.cleanups.push(() => this.win.clearTimeout(heatDebounce));
    this.heatTimer = this.win.setInterval(() => void this.refreshHeat(), HEAT_REFRESH_MS);

    this.resize();
    this.rebuild();
    void this.refreshHeat();
    this.syncRunning();
  }

  highlight(path: string): void {
    const idx = this.graph.paths.indexOf(path);
    if (idx < 0 || !this.nodes) return;
    if (this.highlighted) {
      this.win.clearTimeout(this.highlighted.timer);
      this.applyAttributes();
    }
    const size = this.nodes.geometry.getAttribute("aSize") as BufferAttribute;
    const color = this.nodes.geometry.getAttribute("aColor") as BufferAttribute;
    size.setX(idx, this.baseSize[idx]! * 3 + 1.5);
    color.setXYZ(idx, HIGHLIGHT.r * 2, HIGHLIGHT.g * 2, HIGHLIGHT.b * 2);
    size.needsUpdate = true;
    color.needsUpdate = true;
    this.highlighted = {
      idx,
      timer: this.win.setTimeout(() => {
        this.highlighted = undefined;
        if (!this.disposed) this.applyAttributes();
      }, HIGHLIGHT_MS),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    for (const c of this.cleanups.splice(0)) c();
    this.win.clearTimeout(this.rebuildTimer);
    this.win.clearInterval(this.heatTimer);
    if (this.highlighted) this.win.clearTimeout(this.highlighted.timer);
    this.controls.dispose();
    this.disposeGraphObjects();
    this.nebula.geometry.dispose();
    this.nebulaMat.dispose();
    this.nodeMat.dispose();
    this.lineMat.dispose();
    this.composer.passes.forEach((p) => p.dispose?.());
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.empty.remove();
    this.host.removeClass("kh-brain-canvas-host");
  }

  // --- loop ---

  private syncRunning(): void {
    const should = !this.disposed && this.intersecting && !this.doc.hidden;
    if (should && !this.running) this.start();
    else if (!should && this.running) this.stop();
  }

  private start(): void {
    this.running = true;
    this.last = 0;
    const tick = (ts: number): void => {
      if (!this.running) return;
      this.raf = this.win.requestAnimationFrame(tick);
      const interval = 1000 / this.fps;
      if (this.last !== 0 && ts - this.last < interval - 1.5) return;
      this.last = this.last === 0 ? ts : ts - ((ts - this.last) % interval);
      this.frame(ts / 1000);
    };
    this.raf = this.win.requestAnimationFrame(tick);
  }

  private stop(): void {
    this.running = false;
    if (this.raf) this.win.cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private frame(t: number): void {
    const o = this.src.options();
    this.bloom.strength = o.bloom;
    this.nodeMat.uniforms.uSizeMul!.value = o.nodeSize;
    this.nodeMat.uniforms.uTime!.value = t;
    this.controls.update();
    this.composer.render();
  }

  private resize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (w < 2 || h < 2) return;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const scale = this.renderer.domElement.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    for (const m of [this.nodeMat, this.nebulaMat]) m.uniforms.uScale!.value = scale;
  }

  // --- graph ---

  private scheduleRebuild(): void {
    this.win.clearTimeout(this.rebuildTimer);
    this.rebuildTimer = this.win.setTimeout(() => {
      if (!this.disposed) this.rebuild();
    }, 500);
  }

  private disposeGraphObjects(): void {
    for (const o of [this.nodes, this.lines]) {
      if (!o) continue;
      this.scene.remove(o);
      o.geometry.dispose();
    }
    this.nodes = undefined;
    this.lines = undefined;
  }

  private rebuild(): void {
    const notes = this.src.notes();
    const graph = buildGraph(notes.map((n) => n.path), this.src.resolvedLinks());
    const mt = new Map(notes.map((n) => [n.path, n.mtime] as const));
    this.graph = graph;
    this.mtimes = graph.paths.map((p) => mt.get(p) ?? 0);
    this.disposeGraphObjects();
    this.empty.toggle(graph.paths.length === 0);
    if (this.highlighted) {
      this.win.clearTimeout(this.highlighted.timer);
      this.highlighted = undefined;
    }
    const n = graph.paths.length;
    if (n === 0) return;
    const pos = layoutFor(graph, this.src.layoutCache);
    this.src.saveLayout();

    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setAttribute("aSize", new BufferAttribute(new Float32Array(n), 1));
    g.setAttribute("aColor", new BufferAttribute(new Float32Array(n * 3), 3));
    this.nodes = new Points(g, this.nodeMat);
    this.nodes.frustumCulled = false;
    this.scene.add(this.nodes);

    if (graph.edges.length > 0) {
      const lp = new Float32Array(graph.edges.length * 6);
      graph.edges.forEach(([a, b], i) => {
        lp.set(pos.subarray(a * 3, a * 3 + 3), i * 6);
        lp.set(pos.subarray(b * 3, b * 3 + 3), i * 6 + 3);
      });
      const lg = new BufferGeometry();
      lg.setAttribute("position", new BufferAttribute(lp, 3));
      lg.setAttribute("aColor", new BufferAttribute(new Float32Array(graph.edges.length * 6), 3));
      this.lines = new LineSegments(lg, this.lineMat);
      this.lines.frustumCulled = false;
      this.scene.add(this.lines);
    }
    this.applyAttributes();
    if (!this.framed) this.frameCamera(pos);
  }

  private frameCamera(pos: Float32Array): void {
    let r = 1;
    for (let i = 0; i < pos.length; i += 3) r = Math.max(r, Math.hypot(pos[i]!, pos[i + 1]!, pos[i + 2]!));
    this.camera.position.set(0, 0, r * 2.2 + 10);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.framed = true;
  }

  private async refreshHeat(): Promise<void> {
    try {
      const reads = await this.src.reads();
      if (this.disposed) return;
      this.counts = countReads(reads, Date.now());
    } catch {
      this.counts = new Map();
    }
    if (!this.disposed) this.applyAttributes();
  }

  /** Recomputes node size and colour (heat) and edge colours from the current counts. */
  private applyAttributes(): void {
    const { nodes, lines, graph } = this;
    if (!nodes) return;
    const n = graph.paths.length;
    const now = Date.now();
    const size = new Float32Array(n);
    const col = new Float32Array(n * 3);
    const c = new Color();
    for (let i = 0; i < n; i++) {
      const h = heatOf(this.counts.get(graph.paths[i]!), this.mtimes[i] ?? 0, now);
      size[i] = (0.9 + Math.log1p(graph.degree[i]!) * 0.35) * (1 + h.heat * 1.8);
      c.copy(TEAL).lerp(GOLD, h.heat).multiplyScalar(1 - h.dim * 0.65);
      col.set([c.r, c.g, c.b], i * 3);
    }
    this.baseSize = size;
    (nodes.geometry.getAttribute("aSize") as BufferAttribute).set(size).needsUpdate = true;
    (nodes.geometry.getAttribute("aColor") as BufferAttribute).set(col).needsUpdate = true;
    if (lines) {
      const lc = lines.geometry.getAttribute("aColor") as BufferAttribute;
      graph.edges.forEach(([a, b], i) => {
        lc.setXYZ(i * 2, col[a * 3]! * 0.7, col[a * 3 + 1]! * 0.7, col[a * 3 + 2]! * 0.7);
        lc.setXYZ(i * 2 + 1, col[b * 3]! * 0.7, col[b * 3 + 1]! * 0.7, col[b * 3 + 2]! * 0.7);
      });
      lc.needsUpdate = true;
    }
  }

  private buildNebula(): Points {
    const n = 420;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const col = new Float32Array(n * 3);
    const palette = [new Color(0.1, 0.55, 0.6), new Color(0.35, 0.2, 0.6), new Color(0.12, 0.25, 0.55)];
    let s = 12345;
    const rnd = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1;
      const th = rnd() * Math.PI * 2;
      const r = 500 + rnd() * 500;
      const sq = Math.sqrt(1 - u * u);
      pos.set([r * sq * Math.cos(th), r * sq * Math.sin(th), r * u], i * 3);
      size[i] = 90 + rnd() * 160;
      const p = palette[Math.floor(rnd() * palette.length)]!;
      col.set([p.r, p.g, p.b], i * 3);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setAttribute("aSize", new BufferAttribute(size, 1));
    g.setAttribute("aColor", new BufferAttribute(col, 3));
    const pts = new Points(g, this.nebulaMat);
    pts.frustumCulled = false;
    return pts;
  }
}
