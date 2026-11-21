import type { HubModule, ModuleSettingsDef } from "../../core";
import { createBrainService, type RepoEntry } from "../../core/brain/service";
import { NewDocModal } from "./newDocModal";

export const brainSettings: ModuleSettingsDef = {
  id: "brain",
  defaults: { autoFindings: false, ignoreSymbols: {} },
  enabledByDefault: false,
};

export const brainModule: HubModule = {
  id: "brain",
  load(hub, ctx) {
    const repos = (): Record<string, RepoEntry> => (hub.settings.module("core").repos ?? {}) as Record<string, RepoEntry>;
    const ignoreSymbols = (key: string): string[] => {
      const map = (hub.settings.module("brain").ignoreSymbols ?? {}) as Record<string, string[]>;
      return map[key] ?? [];
    };
    hub.services.register("brain", createBrainService({ repos, ignoreSymbols }));
    ctx.register(() => hub.services.unregister("brain"));
    ctx.addCommand({
      id: "new-doc",
      name: "New doc",
      callback: () => new NewDocModal(hub.app, { repos, now: () => new Date() }).open(),
    });
  },
};
