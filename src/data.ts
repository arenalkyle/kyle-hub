import { defaultSettings } from "./core/defaults";
import type { Settings } from "./core/types";

export interface PluginData {
  settings: Settings;
  idCounter: number;
  setupDone: boolean;
  /** Per-view display/filter state; filled in by Phase 4/5. */
  views: Record<string, unknown>;
  /** Pull request cache; filled in by Phase 8. */
  prCache: Record<string, unknown>;
}

export function defaultData(): PluginData {
  return { settings: defaultSettings(), idCounter: 0, setupDone: false, views: {}, prCache: {} };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Merge persisted data over defaults so missing keys are filled (forward-compatible). */
export function mergeData(raw: unknown): PluginData {
  const d = defaultData();
  if (!isRecord(raw)) return d;
  const settings = isRecord(raw.settings) ? { ...d.settings, ...(raw.settings as Partial<Settings>) } : d.settings;
  return {
    ...d,
    ...(raw as Partial<PluginData>),
    settings,
    idCounter: typeof raw.idCounter === "number" ? raw.idCounter : d.idCounter,
    setupDone: typeof raw.setupDone === "boolean" ? raw.setupDone : d.setupDone,
    views: isRecord(raw.views) ? raw.views : d.views,
    prCache: isRecord(raw.prCache) ? raw.prCache : d.prCache,
  };
}
