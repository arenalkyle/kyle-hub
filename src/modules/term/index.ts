import type { HubModule, ModuleSettingsDef } from "../../core";

export const termSettings: ModuleSettingsDef = { id: "term", defaults: {} };

/** Stub: wired to the old kyle-term code in 2.1. */
export const termModule: HubModule = {
  id: "term",
  load() {},
};
