import type { ModuleSettingsDef } from "../../../core";
import type { PathMode } from "./vault-paths";
import { DEFAULT_SOUNDS, type SoundSettings } from "./alert";
import { DEFAULT_APPEARANCE, mergeAppearance, type AppearanceSettings } from "./appearance";
import { parsePersisted, PERSIST_VERSION, type PersistedSession } from "./persist";

export interface SavedFolder {
  name: string;
  /** Absolute path (may be outside the vault). */
  path: string;
}

export interface TermSettings {
  savedFolders: SavedFolder[];
  pathMode: PathMode;
  nodePath: string;
  defaultProfile: string;
  /** Empty = vault root. */
  claudeStartFolder: string;
  claudeCommand: string;
  /** Seconds of quiet before a non-hook CLI session shows "finished". */
  idleSeconds: number;
  /** Save terminal output so it can be shown again after a restart. */
  restoreScrollback: boolean;
  scrollbackLines: number;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  sounds: SoundSettings;
  appearance: AppearanceSettings;
}

export const DEFAULT_SETTINGS: TermSettings = {
  savedFolders: [],
  pathMode: "relative",
  nodePath: "",
  defaultProfile: "powershell",
  claudeStartFolder: "",
  claudeCommand: "claude",
  idleSeconds: 10,
  restoreScrollback: true,
  scrollbackLines: 2000,
  sidebarWidth: 240,
  sidebarCollapsed: false,
  sounds: DEFAULT_SOUNDS,
  appearance: DEFAULT_APPEARANCE,
};


/** The `term` namespace: terminal settings plus the session metadata that used to live in kyle-term's data.json. */
export interface TermData extends TermSettings {
  version: number;
  sessions: PersistedSession[];
}

export function mergeSounds(saved: Partial<SoundSettings> | undefined): SoundSettings {
  const d = DEFAULT_SOUNDS;
  return {
    muted: saved?.muted ?? d.muted,
    master: saved?.master ?? d.master,
    events: {
      "needs-input": { ...d.events["needs-input"], ...saved?.events?.["needs-input"] },
      finished: { ...d.events.finished, ...saved?.events?.finished },
      "sub-agent-done": { ...d.events["sub-agent-done"], ...saved?.events?.["sub-agent-done"] },
    },
  };
}

export const TERM_DEFAULTS = { ...DEFAULT_SETTINGS, version: PERSIST_VERSION, sessions: [] as PersistedSession[] };

export const termSettings: ModuleSettingsDef = { id: "term", defaults: structuredClone(TERM_DEFAULTS) as unknown as Record<string, unknown> };

/** Fills and un-shares nested defaults on a loaded `modules.term` object (mutated in place). */
export function normalizeTerm(ns: object): void {
  const d = ns as unknown as TermData;
  d.savedFolders = (Array.isArray(d.savedFolders) ? d.savedFolders : []).map((f) => ({ ...f }));
  d.sounds = mergeSounds(d.sounds);
  d.appearance = mergeAppearance(d.appearance);
  d.sessions = parsePersisted(d.sessions);
  if (typeof d.version !== "number") d.version = PERSIST_VERSION;
}
