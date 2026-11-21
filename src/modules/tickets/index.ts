import type { HubModule, ModuleSettingsDef } from "../../core";

export const ticketsSettings: ModuleSettingsDef = { id: "tickets", defaults: {} };

/** Stub: wired to the old kyle-tickets code in 1.2. */
export const ticketsModule: HubModule = {
  id: "tickets",
  load() {},
};
