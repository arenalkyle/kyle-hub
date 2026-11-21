export const MODULE_IDS = ["core", "tickets", "term", "brain", "commandCenter"] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

type Json = Record<string, unknown>;
export type ModuleData = { enabled: boolean } & Json;

export interface Migration {
  /** schemaVersion this migration upgrades to; applied in ascending order when data is older. */
  to: number;
  run(data: Json): Json;
}

export interface ModuleSettingsDef {
  id: ModuleId;
  defaults: Json;
  /** Defaults to true. `core` is always enabled regardless. */
  enabledByDefault?: boolean;
  migrations?: Migration[];
}

export interface HubData {
  schemaVersion: number;
  modules: Record<ModuleId, ModuleData>;
}

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Fills missing keys from defaults, recursing into plain objects; existing values win. */
export function mergeDefaults(defaults: Json, data: Json): Json {
  const out: Json = { ...data };
  for (const [k, d] of Object.entries(defaults)) {
    const v = out[k];
    if (v === undefined) out[k] = isObj(d) ? mergeDefaults(d, {}) : d;
    else if (isObj(d) && isObj(v)) out[k] = mergeDefaults(d, v);
  }
  return out;
}

/** One data.json: `{ schemaVersion, modules: { <id>: { enabled, ...settings } } }`. */
export class SettingsRegistry {
  private defs = new Map<ModuleId, ModuleSettingsDef>();
  private data: HubData | null = null;

  register(def: ModuleSettingsDef): void {
    this.defs.set(def.id, def);
  }

  /** Highest `to` over all registered migrations (1 when none). */
  get currentVersion(): number {
    let v = 1;
    for (const d of this.defs.values()) for (const m of d.migrations ?? []) v = Math.max(v, m.to);
    return v;
  }

  /** Migrate (by schemaVersion), then merge defaults. Unregistered modules default to disabled. */
  load(raw: unknown): HubData {
    const src = isObj(raw) ? raw : {};
    const from = typeof src.schemaVersion === "number" ? src.schemaVersion : 0;
    const rawModules = isObj(src.modules) ? src.modules : {};
    const modules = {} as Record<ModuleId, ModuleData>;
    for (const id of MODULE_IDS) {
      const def = this.defs.get(id);
      let d: Json = isObj(rawModules[id]) ? { ...(rawModules[id] as Json) } : {};
      if (def) {
        const pending = (def.migrations ?? []).filter((m) => m.to > from).sort((a, b) => a.to - b.to);
        for (const m of pending) d = m.run(d);
        d = mergeDefaults({ enabled: def.enabledByDefault ?? true, ...def.defaults }, d);
      } else if (typeof d.enabled !== "boolean") d.enabled = false;
      if (id === "core") d.enabled = true;
      modules[id] = d as ModuleData;
    }
    this.data = { schemaVersion: Math.max(from, this.currentVersion), modules };
    return this.data;
  }

  get all(): HubData {
    if (!this.data) throw new Error("SettingsRegistry.load() not called");
    return this.data;
  }

  module(id: ModuleId): ModuleData {
    return this.all.modules[id];
  }

  isEnabled(id: ModuleId): boolean {
    return id === "core" || this.module(id).enabled === true;
  }

  setEnabled(id: ModuleId, enabled: boolean): void {
    if (id !== "core") this.module(id).enabled = enabled;
  }
}
