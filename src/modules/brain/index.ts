import path from "node:path";
import type { HubModule, ModuleSettingsDef } from "../../core";
import { createBrainService, type RepoEntry } from "../../core/brain/service";
import { DEFAULT_HEALTH_WEIGHTS, type HealthWeights } from "../../core/brain/health";
import { createConventionDocs } from "./conventions";
import { NewDocModal } from "./newDocModal";
import { Notice } from "obsidian";

export const brainSettings: ModuleSettingsDef = {
  id: "brain",
  defaults: { autoFindings: false, ignoreSymbols: {}, healthWeights: { ...DEFAULT_HEALTH_WEIGHTS } },
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
    const weights = (): HealthWeights => ({ ...DEFAULT_HEALTH_WEIGHTS, ...((hub.settings.module("brain").healthWeights ?? {}) as Partial<HealthWeights>) });
    const vaultBrainDir = (): string | undefined => {
      const base = (hub.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.();
      return base ? path.join(base, "Brain") : undefined;
    };
    const svc = createBrainService({
      repos,
      ignoreSymbols,
      vaultBrainDir,
      weights,
      emit: (p) => hub.events.emit("brain:health-changed", p),
    });
    hub.services.register("brain", svc);
    ctx.register(() => hub.services.unregister("brain"));
    try {
      svc.refreshHealth();
    } catch {
      /* health is advisory; a failed scan leaves the previous snapshot */
    }
    ctx.addCommand({
      id: "new-doc",
      name: "New doc",
      callback: () => new NewDocModal(hub.app, { repos, now: () => new Date() }).open(),
    });
    ctx.addCommand({
      id: "create-conventions",
      name: "Create style conventions",
      callback: () => {
        void createConventionDocs(hub.app, new Date().toISOString().slice(0, 10)).then((created) =>
          new Notice(created.length ? `Created ${created.join(", ")}` : "Convention docs already exist"),
        );
      },
    });
  },
};
