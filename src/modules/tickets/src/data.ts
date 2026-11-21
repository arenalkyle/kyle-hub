import { defaultSettings } from "./core/defaults";
import type { PrCacheEntry } from "./core/pr";
import type { Settings } from "./core/types";

export interface MainUiState {
  /** Selected sidebar view id (`all`, `active`, `backlog`, `project:<name>`). */
  view: string;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  /** Collapsed List group keys, per view id. */
  collapsedGroups: Record<string, string[]>;
}

export function defaultMainUi(): MainUiState {
  return { view: "all", sidebarWidth: 220, sidebarCollapsed: false, collapsedGroups: {} };
}

export interface PluginData {
  /** Main view navigation state. */
  main: MainUiState;
  settings: Settings;
  idCounter: number;
  setupDone: boolean;
  /** Per-view display/filter state; filled in by Phase 4/5. */
  views: Record<string, unknown>;
  /** Pull request cache keyed by canonical PR url. */
  prCache: Record<string, PrCacheEntry>;
  /** Result of the last PR auto-link sync. */
  autoLink?: { at: number; ok: boolean; message: string };
}

export function defaultData(): PluginData {
  return { main: defaultMainUi(), settings: defaultSettings(), idCounter: 0, setupDone: false, views: {}, prCache: {} };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Merge persisted data over defaults so missing keys are filled (forward-compatible). */
export function mergeData(raw: unknown): PluginData {
  const d = defaultData();
  if (!isRecord(raw)) return d;
  const settings = isRecord(raw.settings) ? { ...d.settings, ...(raw.settings as Partial<Settings>) } : d.settings;
  const m = isRecord(raw.main) ? (raw.main as Partial<MainUiState>) : {};
  const main: MainUiState = {
    view: typeof m.view === "string" ? m.view : d.main.view,
    sidebarWidth: typeof m.sidebarWidth === "number" ? m.sidebarWidth : d.main.sidebarWidth,
    sidebarCollapsed: typeof m.sidebarCollapsed === "boolean" ? m.sidebarCollapsed : d.main.sidebarCollapsed,
    collapsedGroups: isRecord(m.collapsedGroups) ? (m.collapsedGroups as Record<string, string[]>) : {},
  };
  return {
    ...d,
    ...(raw as Partial<PluginData>),
    main,
    settings,
    idCounter: typeof raw.idCounter === "number" ? raw.idCounter : d.idCounter,
    setupDone: typeof raw.setupDone === "boolean" ? raw.setupDone : d.setupDone,
    views: isRecord(raw.views) ? raw.views : d.views,
    prCache: isRecord(raw.prCache) ? (raw.prCache as Record<string, PrCacheEntry>) : d.prCache,
  };
}
