import path from "node:path";
import type { HubModule, ModuleSettingsDef } from "../../core";
import { createBrainService, type RepoEntry } from "../../core/brain/service";
import { DEFAULT_HEALTH_WEIGHTS, type HealthWeights } from "../../core/brain/health";
import { createConventionDocs } from "./conventions";
import { NewDocModal } from "./newDocModal";
import { Notice, TFile } from "obsidian";
import { planPromote, promoteEligible, scrubOptionsFrom } from "../../core/domain/promote";
import { vaultProfileOf } from "../../core/profile";
import { PromoteModal } from "./promoteModal";

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
    type PromoteCfg = { homeVaultPath?: string; publicHosts?: unknown; denylist?: unknown };
    const openPromote = (name: string, text: string): string | undefined => {
      const core = hub.settings.module("core") as { promote?: PromoteCfg; repos?: Record<string, { github?: unknown }>; profile?: unknown };
      if (vaultProfileOf(core) !== "work") return "Promote runs from a work vault; this vault's profile is home.";
      const ok = promoteEligible(text);
      if (!ok.ok) return ok.reason;
      const plan = planPromote(name, text, scrubOptionsFrom(core.promote, core.repos));
      new PromoteModal(hub.app, plan, core.promote?.homeVaultPath?.trim() ?? "").open();
      return undefined;
    };
    hub.services.register("promote", { open: openPromote });
    ctx.register(() => hub.services.unregister("promote"));
    ctx.addCommand({
      id: "promote-to-home",
      name: "Promote to home",
      checkCallback: (checking) => {
        const f = hub.app.workspace.getActiveFile();
        if (!f || !(f instanceof TFile) || f.extension !== "md" || vaultProfileOf(hub.settings.module("core")) !== "work") return false;
        if (!checking) {
          void hub.app.vault.read(f).then((text) => {
            const why = openPromote(f.name, text);
            if (why) new Notice(`kyle-hub: ${why}`);
          });
        }
        return true;
      },
    });
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
