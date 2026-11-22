import type { EventRef } from "obsidian";
import type { Hub, ModuleContext } from "../../core";
import { normalizeFps } from "../../core/domain/fps";
import { vaultProfileOf } from "../../core/profile";
import type { BrainOptions, BrainSource } from "./scene";

export const DEFAULT_BLOOM = 1.1;
export const DEFAULT_NODE_SIZE = 1;

type Pos = [number, number, number];
type CacheStore = Record<string, Record<string, Pos>>;

const clamp = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

export function brainOptions(settings: Record<string, unknown>): BrainOptions {
  return { bloom: clamp(settings.bloomStrength, 0, 3, DEFAULT_BLOOM), nodeSize: clamp(settings.nodeSize, 0.4, 3, DEFAULT_NODE_SIZE) };
}

/** Builds the vault-backed source for the 3D brain; layout positions are cached per vault in the brain module settings. */
export function createBrainSource(hub: Hub, ctx: ModuleContext): BrainSource {
  const { app } = hub;
  const vaultKey = app.vault.getName();
  const stored = (ctx.settings.get<{ layoutCache?: CacheStore }>().layoutCache ?? {})[vaultKey] ?? {};
  const layoutCache = new Map<string, Pos>(Object.entries(stored));
  let saveTimer = 0;
  const saveNow = (): void => {
    const all = { ...(ctx.settings.get<{ layoutCache?: CacheStore }>().layoutCache ?? {}) };
    all[vaultKey] = Object.fromEntries(layoutCache);
    void ctx.settings.update({ layoutCache: all });
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
    resolvedLinks: () => app.metadataCache.resolvedLinks,
    layoutCache,
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
  };
}
