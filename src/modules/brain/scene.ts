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
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { BrainAccessEvent, BrainHandle } from "../../core";
import type { IdentityLookup } from "../../core/domain/brainAgents";
import { buildGraph, inFolder, nodeLabel, parentFolder, ROOT_FOLDER, withFolders, type BrainGraph } from "../../core/domain/brainGraph";
import { countReads, heatOf, type ReadAccess, type ReadCounts } from "../../core/domain/brainHeat";
import { forceLayout } from "../../core/domain/forceLayout";
import { DEFAULT_FPS } from "../../core/domain/fps";
import { AgentLayer, drift } from "./agents";

export interface BrainOptions {
  bloom: number;
  nodeSize: number;
}

/** Everything the scene needs from the vault and hub; supplied by the brain module so this file stays UI-only. */
export interface BrainSource {
  /** Markdown note paths with modified times, and the resolved link map. */
  notes(): { path: string; mtime: number }[];
  resolvedLinks(): Record<string, Record<string, number>>;
  /** Plain-text start of a note for the hover card ("" when unreadable). */
  snippet(path: string): Promise<string>;
  /** Opens a note without replacing the brain's view: reveals an open tab, else a new tab (a split with Ctrl/Cmd). */
  open(path: string, split: boolean): void;
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
  /** Live `brain:access` events (reads, writes and searches by sessions and sub-agents). */
  onAccess(cb: (e: BrainAccessEvent) => void): () => void;
  /** Terminal session start / end. */
  onSession(cb: (kind: "started" | "ended", sessionId: string) => void): () => void;
  /** Pane title, colour and folder for a session id; undefined for sessions with no terminal pane. */
  identity: IdentityLookup;
}

const TEAL = new Color(0.1, 0.78, 0.72);
const GOLD = new Color(1.0, 0.76, 0.22);
const HIGHLIGHT = new Color(1, 1, 1);
const FOLDER = new Color(0.62, 0.45, 1.0);
const ROOT = new Color(0.85, 0.8, 1.0);
/** Colour factor for nodes outside the focused folder. */
const UNFOCUSED = 0.1;
const PICK_PX = 10;
const CLICK_SLOP_PX = 4;
const FLY_MS = 700;
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
  private graph: BrainGraph = { paths: [], edges: [], degree: [], kinds: [], edgeKinds: [] };
  private focus: string | null = null;
  private fly: { from: Vector3; to: Vector3; camFrom: Vector3; camTo: Vector3; start: number } | undefined;
  private hovered: number | undefined;
  private hoverToken = 0;
  private time = 0;
  private folderSelect: HTMLSelectElement;
  private labels: HTMLElement;
  private readonly labelEls = new Map<string, HTMLElement>();
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
  private readonly agentLayer: AgentLayer;
  private pathIndex = new Map<string, number>();
  private pos: Float32Array = new Float32Array(0);
  private radius = 30;
  private tip: HTMLElement;

  constructor(private readonly host: HTMLElement, private readonly src: BrainSource) {
    this.win = host.win ?? window;
    this.doc = host.ownerDocument;
    this.fps = src.fps() || DEFAULT_FPS;
    host.addClass("kh-brain-canvas-host");
    this.renderer = new WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(this.win.devicePixelRatio || 1, 2));
    // Background via scene.background, not setClearColor: the clear colour is colour-space converted for whichever
    // target is bound when it is set, so inside the composer it landed sRGB-encoded (0.15) in the linear buffer,
    // crossed the bloom threshold and bloomed the whole canvas to white.
    this.scene.background = new Color(0.02, 0.03, 0.07);
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
      uniforms: { uTime: this.nodeMat.uniforms.uTime!, uAlpha: { value: 0.45 } },
      vertexShader: LINE_VS,
      fragmentShader: LINE_FS,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.nebulaMat.uniforms.uTime = this.nodeMat.uniforms.uTime!;
    this.nebula = this.buildNebula();
    this.scene.add(this.nebula);
    this.agentLayer = new AgentLayer(this.scene, {
      notePos: (p) => {
        const i = this.pathIndex.get(p);
        return i === undefined ? undefined : [this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!];
      },
      radius: () => this.radius,
      identity: (id) => src.identity(id),
    });
    this.labels = host.createDiv({ cls: "kh-brain-labels" });
    this.tip = host.createDiv({ cls: "kh-brain-tip" });
    this.tip.hide();
    this.folderSelect = host.createEl("select", { cls: "dropdown kh-brain-folders", attr: { "aria-label": "Focus a folder" } });
    this.folderSelect.addEventListener("change", () => this.focusFolder(this.folderSelect.value || null));
    const onMove = (ev: PointerEvent): void => {
      const r = canvas.getBoundingClientRect();
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      const hit = this.agentLayer.pick(x, y, this.camera, r.width, r.height);
      if (hit) {
        this.setHovered(undefined);
        this.tip.empty();
        this.tip.createDiv({ cls: "kh-brain-tip-name", text: hit.name });
        this.tip.createDiv({ cls: "kh-brain-tip-note", text: hit.note ?? "no note yet" });
        this.placeTip(hit.x, hit.y);
        this.tip.show();
        return;
      }
      this.setHovered(this.pickNode(x, y, r.width, r.height), x, y);
    };
    const onLeave = (): void => this.setHovered(undefined);
    let down: { x: number; y: number } | undefined;
    const onDown = (ev: PointerEvent): void => void (down = { x: ev.clientX, y: ev.clientY });
    const onUp = (ev: PointerEvent): void => {
      const d = down;
      down = undefined;
      if (!d || Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > CLICK_SLOP_PX || ev.button !== 0) return;
      const idx = this.hovered;
      if (idx === undefined) return;
      const path = this.graph.paths[idx]!;
      if (this.graph.kinds[idx] === "note") this.src.open(path, ev.ctrlKey || ev.metaKey);
      else this.focusFolder(path === ROOT_FOLDER || path === this.focus ? null : path);
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    this.cleanups.push(() => {
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
    });
    this.cleanups.push(src.onAccess((e) => this.agentLayer.access(e)));
    this.cleanups.push(src.onSession((k, id) => this.agentLayer.session(k, id)));

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
    this.agentLayer.dispose();
    this.tip.remove();
    this.labels.remove();
    this.folderSelect.remove();
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
    this.time = t;
    if (this.fly) {
      const k = Math.min(1, (performance.now() - this.fly.start) / FLY_MS);
      const e = 1 - (1 - k) ** 3;
      this.controls.target.lerpVectors(this.fly.from, this.fly.to, e);
      this.camera.position.lerpVectors(this.fly.camFrom, this.fly.camTo, e);
      if (k >= 1) this.fly = undefined;
    }
    this.controls.update();
    this.agentLayer.frame(t);
    this.composer.render();
    this.paintLabels();
  }

  // --- hover, click, folders, labels ---

  /** Nearest node under a canvas pixel, or undefined. Uses the same drift as the shaders. */
  private pickNode(x: number, y: number, width: number, height: number): number | undefined {
    if (!this.nodes || width < 2 || height < 2) return undefined;
    const v = new Vector3();
    const view = new Vector3();
    const dpr = this.renderer.getPixelRatio();
    const scale = (this.nodeMat.uniforms.uScale!.value as number) * this.src.options().nodeSize;
    let best: number | undefined;
    let bestD = Infinity;
    for (let i = 0; i < this.graph.paths.length; i++) {
      drift([this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!], this.time, v);
      const depth = -view.copy(v).applyMatrix4(this.camera.matrixWorldInverse).z;
      if (depth <= 0.1) continue;
      v.project(this.camera);
      const sx = (v.x * 0.5 + 0.5) * width, sy = (-v.y * 0.5 + 0.5) * height;
      const d = Math.hypot(sx - x, sy - y);
      const reach = Math.max(PICK_PX, (((this.baseSize[i] ?? 1) * scale) / depth / dpr) * 0.35);
      if (d < reach && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private setHovered(idx: number | undefined, x = 0, y = 0): void {
    this.renderer.domElement.setCssProps({ cursor: idx === undefined ? "" : "pointer" });
    if (idx === undefined) {
      this.hovered = undefined;
      this.tip.hide();
      return;
    }
    if (idx === this.hovered) return this.placeTip(x, y);
    this.hovered = idx;
    const path = this.graph.paths[idx]!;
    const folder = this.graph.kinds[idx] === "folder";
    const token = ++this.hoverToken;
    this.tip.empty();
    this.tip.createDiv({ cls: "kh-brain-tip-name", text: nodeLabel(path) });
    const parent = parentFolder(path);
    if (path !== ROOT_FOLDER) this.tip.createDiv({ cls: "kh-brain-tip-folder", text: parent === ROOT_FOLDER ? "Vault root" : parent.slice(0, -1) });
    if (folder) {
      const notes = this.graph.paths.filter((p, i) => this.graph.kinds[i] === "note" && inFolder(p, path)).length;
      this.tip.createDiv({ cls: "kh-brain-tip-note", text: `${notes} note${notes === 1 ? "" : "s"}` });
      this.tip.createDiv({ cls: "kh-brain-tip-hint", text: path === ROOT_FOLDER || path === this.focus ? "Click to show everything" : "Click to focus this folder" });
    } else {
      const links = this.graph.edges.filter(([a, b], i) => this.graph.edgeKinds[i] === "link" && (a === idx || b === idx)).length;
      const snip = this.tip.createDiv({ cls: "kh-brain-tip-snippet", text: "…" });
      this.tip.createDiv({ cls: "kh-brain-tip-hint", text: `${links} link${links === 1 ? "" : "s"} · click to open` });
      void this.src.snippet(path).then(
        (t) => {
          if (token === this.hoverToken) snip.setText(t || "(empty note)");
        },
        () => undefined,
      );
    }
    this.placeTip(x, y);
    this.tip.show();
  }

  /** Keeps the card inside the host, beside the pointer. */
  private placeTip(x: number, y: number): void {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    const left = x + 280 > w ? Math.max(4, x - 284) : x + 14;
    const top = y + 140 > h ? Math.max(4, y - 140) : y + 14;
    this.tip.setCssProps({ left: `${left}px`, top: `${top}px` });
  }

  /** Dims everything outside `folder` and flies the camera to it; null shows the whole vault. */
  private focusFolder(folder: string | null): void {
    this.focus = folder === ROOT_FOLDER ? null : folder;
    this.folderSelect.value = this.focus ?? "";
    this.applyAttributes();
    if (this.graph.paths.length === 0) return;
    const at = (i: number): Vector3 => new Vector3(this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!);
    const members: number[] = [];
    this.graph.paths.forEach((p, i) => {
      if (this.focus === null || inFolder(p, this.focus)) members.push(i);
    });
    const centre = new Vector3();
    for (const i of members) centre.add(at(i));
    centre.divideScalar(Math.max(1, members.length));
    let r = 6;
    for (const i of members) r = Math.max(r, centre.distanceTo(at(i)));
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.lengthSq() === 0) dir.set(0, 0, 1);
    this.fly = {
      from: this.controls.target.clone(),
      to: centre,
      camFrom: this.camera.position.clone(),
      camTo: centre.clone().add(dir.multiplyScalar(r * 2.2 + 10)),
      start: performance.now(),
    };
  }

  private fillFolderSelect(): void {
    const sel = this.folderSelect;
    sel.empty();
    sel.createEl("option", { text: "All folders", value: "" });
    const folders = this.graph.paths.filter((p, i) => this.graph.kinds[i] === "folder" && p !== ROOT_FOLDER);
    for (const f of folders) {
      const n = this.graph.paths.filter((p, i) => this.graph.kinds[i] === "note" && inFolder(p, f)).length;
      const depth = f.split("/").length - 2;
      sel.createEl("option", { text: `${"\u00A0\u00A0".repeat(depth)}${nodeLabel(f)} (${n})`, value: f });
    }
    sel.value = this.focus ?? "";
    sel.toggle(folders.length > 0);
  }

  /** Name tags that follow each agent on screen. */
  private paintLabels(): void {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    const seen = new Set<string>();
    for (const l of this.agentLayer.labels(this.camera, w, h)) {
      seen.add(l.id);
      let el = this.labelEls.get(l.id);
      if (!el) {
        el = this.labels.createDiv({ cls: "kh-brain-label" });
        this.labelEls.set(l.id, el);
      }
      if (el.textContent !== l.name) el.setText(l.name);
      el.setCssProps({ transform: `translate(${Math.round(l.x + 9)}px, ${Math.round(l.y - 9)}px)`, opacity: String(l.alpha), "--kh-brain-agent-color": l.color });
    }
    for (const [id, el] of this.labelEls) {
      if (seen.has(id)) continue;
      el.remove();
      this.labelEls.delete(id);
    }
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
    this.agentLayer.setScale(scale);
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
    const graph = withFolders(buildGraph(notes.map((n) => n.path), this.src.resolvedLinks()));
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
    this.hovered = undefined;
    this.fillFolderSelect();
    if (this.focus && !graph.paths.includes(this.focus)) this.focus = null;
    if (n === 0) return;
    const pos = layoutFor(graph, this.src.layoutCache);
    this.pos = pos;
    this.pathIndex = new Map(graph.paths.map((p, i) => [p, i] as const));
    let rad = 1;
    for (let i = 0; i < pos.length; i += 3) rad = Math.max(rad, Math.hypot(pos[i]!, pos[i + 1]!, pos[i + 2]!));
    this.radius = rad;
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
      const path = graph.paths[i]!;
      if (graph.kinds[i] === "folder") {
        size[i] = path === ROOT_FOLDER ? 3.2 : 1.8 + Math.log1p(graph.degree[i]!) * 0.45;
        c.copy(path === ROOT_FOLDER ? ROOT : FOLDER);
      } else {
        const h = heatOf(this.counts.get(path), this.mtimes[i] ?? 0, now);
        size[i] = (0.9 + Math.log1p(graph.degree[i]!) * 0.35) * (1 + h.heat * 1.8);
        c.copy(TEAL).lerp(GOLD, h.heat).multiplyScalar(1 - h.dim * 0.65);
      }
      if (this.focus && !inFolder(path, this.focus)) c.multiplyScalar(UNFOCUSED);
      col.set([c.r, c.g, c.b], i * 3);
    }
    this.baseSize = size;
    (nodes.geometry.getAttribute("aSize") as BufferAttribute).set(size).needsUpdate = true;
    (nodes.geometry.getAttribute("aColor") as BufferAttribute).set(col).needsUpdate = true;
    if (lines) {
      const lc = lines.geometry.getAttribute("aColor") as BufferAttribute;
      // Links (wikilinks, frontmatter references) bright; folder tree edges fainter.
      graph.edges.forEach(([a, b], i) => {
        const k = graph.edgeKinds[i] === "link" ? 1.6 : 0.75;
        lc.setXYZ(i * 2, col[a * 3]! * k, col[a * 3 + 1]! * k, col[a * 3 + 2]! * k);
        lc.setXYZ(i * 2 + 1, col[b * 3]! * k, col[b * 3 + 1]! * k, col[b * 3 + 2]! * k);
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
