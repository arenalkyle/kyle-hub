import type { App } from "obsidian";
import { EventBus } from "./events";
import { ServiceRegistry } from "./services";
import { SettingsRegistry, type ModuleId } from "./settings";

/** What every module receives; the only thing a module may depend on besides itself. */
export interface Hub {
  app: App;
  services: ServiceRegistry;
  events: EventBus;
  settings: SettingsRegistry;
  /** Persist data.json. */
  save(): Promise<void>;
}

export interface HubModule {
  id: Exclude<ModuleId, "core">;
  load(hub: Hub): void | Promise<void>;
  unload?(): void | Promise<void>;
}

export function createHubParts(): Pick<Hub, "services" | "events" | "settings"> {
  return { services: new ServiceRegistry(), events: new EventBus(), settings: new SettingsRegistry() };
}

/** Calls `load(hub)` only for modules whose `enabled` flag is set; returns the ones loaded. */
export async function loadModules(hub: Hub, modules: readonly HubModule[]): Promise<HubModule[]> {
  const loaded: HubModule[] = [];
  for (const m of modules) {
    if (!hub.settings.isEnabled(m.id)) continue;
    try {
      await m.load(hub);
      loaded.push(m);
    } catch (e) {
      console.error(`kyle-hub: module ${m.id} failed to load`, e);
    }
  }
  return loaded;
}
