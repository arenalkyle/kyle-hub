import type { Hub, HubModule, ModuleSettingsDef, ServiceRegistry } from "../../core";
import { DEFAULT_FPS, FPS_CHOICES, normalizeFps } from "../../core/domain/fps";
import { DEFAULT_GAPS_CUTOFF } from "../../core/domain/gapsRank";
import { Setting } from "obsidian";
import { scopeLogs } from "../../core/logs/scoped";
import { vaultProfileOf } from "../../core/profile";
import type { CommandCenterReader } from "./model";
import { planBrainLeafMigration } from "../../core/domain/brainMenu";
import { COMMAND_CENTER_VIEW_TYPE, CommandCenterView, LEGACY_BRAIN_VIEW_TYPE } from "./view";

/** Services are looked up on every refresh: a module that is off shows as disabled. */
/** Logs are scoped to the vault profile: a work vault never shows home runs and vice versa. */
const readerFrom = (s: ServiceRegistry, profile: () => ReturnType<typeof vaultProfileOf>): CommandCenterReader => ({
  tickets: s.get("tickets"),
  sessions: s.get("sessions"),
  attention: s.get("attention"),
  retro: s.get("retro"),
  gaps: s.get("gaps"),
  brain: s.get("brain"),
  usage: s.get("usage"),
  logs: ((l) => (l ? scopeLogs(l, profile()) : undefined))(s.get("logs")),
});

async function openCommandCenter(hub: Hub): Promise<void> {
  const ws = hub.app.workspace;
  const leaf = ws.getLeavesOfType(COMMAND_CENTER_VIEW_TYPE)[0] ?? ws.getLeaf("tab");
  await leaf.setViewState({ type: COMMAND_CENTER_VIEW_TYPE, active: true });
  void ws.revealLeaf(leaf);
}

/** `rateUnit` is the Brain Vitals menu choice; `fps` is shared with the 3D brain (LOCK-67). */
export const commandCenterSettings: ModuleSettingsDef = {
  id: "commandCenter",
  defaults: { rateUnit: "hour", fps: DEFAULT_FPS, gapsCutoff: DEFAULT_GAPS_CUTOFF },
  enabledByDefault: false,
};

export const commandCenterModule: HubModule = {
  id: "commandCenter",
  load(hub, ctx) {
    const focusTicket = async (ticketId: string): Promise<void> => {
      await hub.services.get("attention")?.focus(ticketId);
    };
    ctx.registerView(COMMAND_CENTER_VIEW_TYPE, (leaf) => new CommandCenterView(leaf, hub, () => readerFrom(hub.services, () => vaultProfileOf(hub.settings.module("core"))), focusTicket));
    const open = (): void => void openCommandCenter(hub);
    ctx.addRibbonIcon("layout-dashboard", "Open command center", open);
    ctx.addNavItem({ id: "command-center", label: "Command Center", icon: "layout-dashboard", viewType: COMMAND_CENTER_VIEW_TYPE, order: 0, open });
    ctx.addCommand({ id: "command-center-open", name: "Open command center", callback: open });
    // The Brain tab is gone (LOCK-79): saved brain leaves become the Command Center, or close when one is open.
    hub.app.workspace.onLayoutReady(() => {
      const ws = hub.app.workspace;
      const saved = ws.getLeavesOfType(LEGACY_BRAIN_VIEW_TYPE);
      const plan = planBrainLeafMigration(saved.length, ws.getLeavesOfType(COMMAND_CENTER_VIEW_TYPE).length > 0);
      saved.forEach((leaf, i) => {
        if (i < plan.convert) void leaf.setViewState({ type: COMMAND_CENTER_VIEW_TYPE, active: true });
        else leaf.detach();
      });
    });
    ctx.addSettingsSection({
      render(el) {
        new Setting(el)
          .setName("Brain FPS")
          .setDesc("Shared with the 3D brain. Takes effect without a reload.")
          .addDropdown((d) =>
            d
              .addOptions(Object.fromEntries(FPS_CHOICES.map((f) => [String(f), String(f)])))
              .setValue(String(normalizeFps(ctx.settings.get<{ fps?: unknown }>().fps)))
              .onChange(async (v) => {
                const fps = normalizeFps(Number(v));
                await ctx.settings.update({ fps });
                hub.events.emit("display:fps-changed", { fps });
              }),
          );
      },
    });
  },
};
