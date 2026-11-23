import path from "node:path";
import type { HubModule, ModuleSettingsDef } from "../../core";
import { createBrainService, type RepoEntry } from "../../core/brain/service";
import { DEFAULT_HEALTH_WEIGHTS, type HealthWeights } from "../../core/brain/health";
import { createConventionDocs } from "./conventions";
import { NewDocModal } from "./newDocModal";
import { Notice, Setting, TFile } from "obsidian";
import { planPromote, promoteEligible, scrubOptionsFrom } from "../../core/domain/promote";
import { vaultProfileOf } from "../../core/profile";
import { PromoteModal } from "./promoteModal";
import { BrainScene } from "./scene";
import { createGapsService } from "./gaps";
import { DEFAULT_ROTATE_SPEED } from "../../core/domain/autoRotate";
import { BRAIN_THEMES, DEFAULT_THEME } from "../../core/domain/brainTheme";
import { SHAPES } from "../../core/domain/brainShape";
import {
  DEFAULT_ORBIT_COLOR,
  DEFAULT_ORBIT_MODE,
  DEFAULT_ORBIT_OPACITY,
  DEFAULT_TOASTS,
  isOrbitHex,
  normalizeOrbitColor,
  normalizeOrbitMode,
  normalizeOrbitOpacity,
  normalizeToasts,
  nextOrbitColor,
  ORBIT_MODES,
  orbitColorKind,
} from "../../core/domain/brainMenu";
import { brainOptions, createBrainSource, DEFAULT_BLOOM, DEFAULT_NODE_SIZE, DEFAULT_SHAPE } from "./source";

export const brainSettings: ModuleSettingsDef = {
  id: "brain",
  defaults: {
    autoFindings: false,
    ignoreSymbols: {},
    healthWeights: { ...DEFAULT_HEALTH_WEIGHTS },
    bloomStrength: DEFAULT_BLOOM,
    nodeSize: DEFAULT_NODE_SIZE,
    layoutCache: {},
    shapeCache: {},
    theme: DEFAULT_THEME,
    shape: DEFAULT_SHAPE,
    rotateSpeed: DEFAULT_ROTATE_SPEED,
    orbitMode: DEFAULT_ORBIT_MODE,
    orbitColor: DEFAULT_ORBIT_COLOR,
    orbitOpacity: DEFAULT_ORBIT_OPACITY,
    toasts: DEFAULT_TOASTS,
  },
  enabledByDefault: false,
};

export const brainModule: HubModule = {
  id: "brain",
  load(hub, ctx) {
    // The human's own note opens feed the vitals human line (LOCK-65); written through the logs service.
    ctx.registerEvent(hub.app.workspace.on("file-open", (f) => {
      if (!(f instanceof TFile) || f.extension !== "md") return;
      const t = new Date().toISOString();
      hub.services.get("logs")?.appendHumanOpen({ profile: vaultProfileOf(hub.settings.module("core")), path: f.path, t });
      hub.events.emit("brain:human-open", { t, path: f.path });
    }));
    const repos = (): Record<string, RepoEntry> =>(hub.settings.module("core").repos ?? {}) as Record<string, RepoEntry>;
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
    const brainSource = createBrainSource(hub, ctx);
    hub.services.register("brainView", { mount: (el) => new BrainScene(el, brainSource) });
    const gapsBase = (hub.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.();
    const gaps = createGapsService(gapsBase);
    hub.services.register("gaps", gaps.service);
    ctx.register(() => {
      gaps.dispose();
      hub.services.unregister("gaps");
    });
    ctx.register(() => hub.services.unregister("brainView"));
    ctx.addSettingsSection({
      render(el) {
        const cur = brainOptions(ctx.settings.get());
        new Setting(el)
          .setName("Brain bloom strength")
          .setDesc("Glow of the 3D brain. Applies live.")
          .addSlider((sl) => sl.setLimits(0, 3, 0.1).setValue(cur.bloom).setDynamicTooltip().onChange((v) => void ctx.settings.update({ bloomStrength: v })));
        new Setting(el)
          .setName("Brain node size")
          .setDesc("Size multiplier for notes in the 3D brain. Applies live.")
          .addSlider((sl) => sl.setLimits(0.4, 3, 0.1).setValue(cur.nodeSize).setDynamicTooltip().onChange((v) => void ctx.settings.update({ nodeSize: v })));
        const raw = ctx.settings.get<{ orbitMode?: unknown; orbitColor?: unknown; orbitOpacity?: unknown; toasts?: unknown }>();
        const save = (patch: Record<string, unknown>): void => void ctx.settings.update(patch);
        const colour = normalizeOrbitColor(raw.orbitColor);
        new Setting(el)
          .setName("Brain theme")
          .setDesc("Colours of the 3D brain. Applies live.")
          .addDropdown((d) => d.addOptions(Object.fromEntries(BRAIN_THEMES.map((t) => [t.id, t.name]))).setValue(cur.theme).onChange((v) => save({ theme: v })));
        new Setting(el)
          .setName("Brain shape")
          .setDesc("Applies live.")
          .addDropdown((d) => d.addOptions(Object.fromEntries(SHAPES.map((s) => [s.id, s.name]))).setValue(cur.shape).onChange((v) => save({ shape: v })));
        new Setting(el)
          .setName("Rotation speed")
          .setDesc("0 stops the auto-rotation. Applies live.")
          .addSlider((sl) => sl.setLimits(0, 1, 0.05).setValue(cur.rotateSpeed).setDynamicTooltip().onChange((v) => save({ rotateSpeed: v })));
        new Setting(el)
          .setName("Orbit mode")
          .addDropdown((d) => d.addOptions(Object.fromEntries(ORBIT_MODES.map((m) => [m, m]))).setValue(normalizeOrbitMode(raw.orbitMode)).onChange((v) => save({ orbitMode: v })));
        new Setting(el)
          .setName("Orbit colour")
          .addDropdown((d) =>
            d
              .addOptions({ default: "Default", rainbow: "Rainbow", custom: "Custom hex" })
              .setValue(orbitColorKind(colour))
              .onChange((v) => save({ orbitColor: nextOrbitColor(v as "default" | "rainbow" | "custom", colour) })),
          )
          .addText((t) =>
            t
              .setPlaceholder("#rrggbb")
              .setValue(orbitColorKind(colour) === "custom" ? colour : "")
              .onChange((v) => {
                if (isOrbitHex(v)) save({ orbitColor: normalizeOrbitColor(v) });
              }),
          );
        new Setting(el)
          .setName("Orbit opacity")
          .addSlider((sl) => sl.setLimits(0, 1, 0.05).setValue(normalizeOrbitOpacity(raw.orbitOpacity)).setDynamicTooltip().onChange((v) => save({ orbitOpacity: v })));
        new Setting(el)
          .setName("Notifications")
          .setDesc("Toast notices from the brain.")
          .addToggle((t) => t.setValue(normalizeToasts(raw.toasts)).onChange((v) => save({ toasts: v })));
        new Setting(el)
          .setName("Notes-read rate")
          .setDesc("Unit for the Brain Vitals notes-read rate.")
          .addDropdown((d) =>
            d
              .addOptions({ hour: "Per hour", minute: "Per min" })
              .setValue(hub.settings.module("commandCenter").rateUnit === "minute" ? "minute" : "hour")
              .onChange((v) => {
                hub.settings.module("commandCenter").rateUnit = v === "minute" ? "minute" : "hour";
                void hub.save();
              }),
          );
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
