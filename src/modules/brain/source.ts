import type { EventRef } from "obsidian";
import { frontmatterRefs, noteSnippet } from "../../core/domain/brainGraph";
import type { Hub, ModuleContext } from "../../core";
import { normalizeFps } from "../../core/domain/fps";
import { vaultProfileOf } from "../../core/profile";
import { rotateSpeedOf } from "../../core/domain/autoRotate";
import { normalizeOrbitColor, normalizeOrbitMode, normalizeOrbitOpacity } from "../../core/domain/brainMenu";
import { isThemeId, DEFAULT_THEME } from "../../core/domain/brainTheme";
import { newShapeCache, SHAPES, type ShapeCache, type ShapeId } from "../../core/domain/brainShape";
import type { BrainOptions, BrainSource } from "./scene";

export const DEFAULT_BLOOM = 1.1;
export const DEFAULT_NODE_SIZE = 1;

type Pos = [number, number, number];
type CacheStore = Record<string, Record<string, Pos>>;

const clamp = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

export const DEFAULT_SHAPE: ShapeId = "brain";

export function brainOptions(settings: Record<string, unknown>): BrainOptions {
  return {
    bloom: clamp(settings.bloomStrength, 0, 3, DEFAULT_BLOOM),
    nodeSize: clamp(settings.nodeSize, 0.4, 3, DEFAULT_NODE_SIZE),
    theme: isThemeId(settings.theme) ? settings.theme : DEFAULT_THEME,
    shape: SHAPES.find((s) => s.id === settings.shape)?.id ?? DEFAULT_SHAPE,
    rotateSpeed: rotateSpeedOf(settings.rotateSpeed),
    orbitMode: normalizeOrbitMode(settings.orbitMode),
    orbitColor: normalizeOrbitColor(settings.orbitColor),
    orbitOpacity: normalizeOrbitOpacity(settings.orbitOpacity),
  };
}

type ShapeStore = Record<string, { slots?: Record<string, number>; weights?: Record<string, number> }>;

function loadShapeCache(raw: ShapeStore[string] | undefined): ShapeCache {
  const c = newShapeCache();
  for (const [k, v] of Object.entries(raw?.slots ?? {})) if (typeof v === "number") c.slots.set(k, v);
  for (const [k, v] of Object.entries(raw?.weights ?? {})) if (typeof v === "number" && Number.isFinite(Number(k))) c.weights.set(Number(k), v);
  return c;
}

/** Builds the vault-backed source for the 3D brain; layout positions are cached per vault in the brain module settings. */
export function createBrainSource(hub: Hub, ctx: ModuleContext): BrainSource {
  const { app } = hub;
  const vaultKey = app.vault.getName();
  const stored = (ctx.settings.get<{ layoutCache?: CacheStore }>().layoutCache ?? {})[vaultKey] ?? {};
  // Caches from before folder hubs (no `folder/` keys) are dropped once so notes re-cluster around their folders.
  const legacy = Object.keys(stored).length > 0 && !Object.keys(stored).some((k) => k.endsWith("/"));
  const layoutCache = new Map<string, Pos>(legacy ? [] : Object.entries(stored));
  const shapeCache = loadShapeCache((ctx.settings.get<{ shapeCache?: ShapeStore }>().shapeCache ?? {})[vaultKey]);
  let saveTimer = 0;
  const saveNow = (): void => {
    const all = { ...(ctx.settings.get<{ layoutCache?: CacheStore }>().layoutCache ?? {}) };
    all[vaultKey] = Object.fromEntries(layoutCache);
    const shapes = { ...(ctx.settings.get<{ shapeCache?: ShapeStore }>().shapeCache ?? {}) };
    shapes[vaultKey] = { slots: Object.fromEntries(shapeCache.slots), weights: Object.fromEntries(shapeCache.weights) };
    void ctx.settings.update({ layoutCache: all, shapeCache: shapes });
  };
  ctx.register(() => {
    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveNow();
    }
  });

  // Renames keep their node position: move the cache entry before listeners rebuild.
  ctx.registerEvent(
    app.vault.on("rename", (file, oldPath) => {
      const p = layoutCache.get(oldPath);
      if (p) {
        layoutCache.delete(oldPath);
        layoutCache.set(file.path, p);
      }
    }),
  );

  const listen = (cb: () => void): (() => void) => {
    const refs: { off: () => void }[] = [];
    const reg = (ref: EventRef, owner: { offref(r: EventRef): void }): void => void refs.push({ off: () => owner.offref(ref) });
    reg(app.vault.on("create", cb), app.vault);
    reg(app.vault.on("rename", cb), app.vault);
    reg(app.vault.on("delete", cb), app.vault);
    reg(app.metadataCache.on("resolved", cb), app.metadataCache);
    return () => refs.forEach((r) => r.off());
  };

  return {
    notes: () => app.vault.getMarkdownFiles().map((f) => ({ path: f.path, mtime: f.stat.mtime })),
    resolvedLinks() {
      // Wikilinks plus frontmatter values that name another note (a ticket's `project`, `parent`, ...).
      const out: Record<string, Record<string, number>> = {};
      for (const [src, targets] of Object.entries(app.metadataCache.resolvedLinks)) out[src] = { ...targets };
      for (const f of app.vault.getMarkdownFiles()) {
        const fm = app.metadataCache.getFileCache(f)?.frontmatter;
        const refs = frontmatterRefs(fm, f.path, (t) => app.metadataCache.getFirstLinkpathDest(t, f.path)?.path);
        if (refs.length === 0) continue;
        const row = (out[f.path] ??= {});
        for (const r of refs) row[r] = (row[r] ?? 0) + 1;
      }
      return out;
    },
    async snippet(path) {
      const f = app.vault.getFileByPath(path);
      return f ? noteSnippet(await app.vault.cachedRead(f)) : "";
    },
    open(path, split) {
      // Never replace the view hosting the brain: reveal the note if it is open, else open it in a new tab.
      const leaf = app.workspace.getLeavesOfType("markdown").find((l) => (l.view as { file?: { path: string } }).file?.path === path);
      if (leaf && !split) return void app.workspace.setActiveLeaf(leaf, { focus: true });
      void app.workspace.openLinkText(path, "", split ? "split" : "tab");
    },
    layoutCache,
    shapeCache,
    saveLayout() {
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        saveTimer = 0;
        saveNow();
      }, 2000);
    },
    async reads() {
      const logs = hub.services.get("logs");
      if (!logs) return [];
      const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
      const rows = await logs.accessSince(since, vaultProfileOf(hub.settings.module("core")));
      return rows.filter((r) => r.kind === "read");
    },
    options: () => brainOptions(ctx.settings.get()),
    fps: () => normalizeFps(hub.settings.module("commandCenter").fps),
    onFps: (cb) => hub.events.on("display:fps-changed", (e) => cb(normalizeFps(e.fps))),
    onGraphChange: listen,
    onHeatDirty: (cb) => hub.events.on("brain:access", () => cb()),
    onAccess: (cb) => hub.events.on("brain:access", cb),
    onSession(cb) {
      const offs = [hub.events.on("session:started", (e) => cb("started", e.sessionId)), hub.events.on("session:ended", (e) => cb("ended", e.sessionId))];
      return () => offs.forEach((off) => off());
    },
    onSubagent(cb) {
      const offs = [
        hub.events.on("subagent:started", (e) => cb("started", e.sessionId, e.agentId, e.agentType)),
        hub.events.on("subagent:ended", (e) => cb("ended", e.sessionId, e.agentId)),
      ];
      return () => offs.forEach((off) => off());
    },
    identity(sessionId) {
      const s = hub.services.get("sessions")?.get(sessionId);
      return s ? { title: s.title, color: s.color, cwd: s.cwd, kind: s.kind } : undefined;
    },
  };
}
