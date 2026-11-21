import type { Hub, HubModule, ServiceRegistry } from "../../core";
import type { CommandCenterReader } from "./model";
import { COMMAND_CENTER_VIEW_TYPE, CommandCenterView } from "./view";

/** Services are looked up on every refresh: a module that is off shows as disabled. */
const readerFrom = (s: ServiceRegistry): CommandCenterReader => ({
  tickets: s.get("tickets"),
  sessions: s.get("sessions"),
  attention: s.get("attention"),
  retro: s.get("retro"),
  brain: s.get("brain"),
  logs: s.get("logs"),
});

async function openCommandCenter(hub: Hub): Promise<void> {
  const ws = hub.app.workspace;
  const leaf = ws.getLeavesOfType(COMMAND_CENTER_VIEW_TYPE)[0] ?? ws.getLeaf("tab");
  await leaf.setViewState({ type: COMMAND_CENTER_VIEW_TYPE, active: true });
  void ws.revealLeaf(leaf);
}

export const commandCenterModule: HubModule = {
  id: "commandCenter",
  load(hub, ctx) {
    const focusTicket = async (ticketId: string): Promise<void> => {
      await hub.services.get("attention")?.focus(ticketId);
    };
    ctx.registerView(COMMAND_CENTER_VIEW_TYPE, (leaf) => new CommandCenterView(leaf, hub, () => readerFrom(hub.services), focusTicket));
    const open = (): void => void openCommandCenter(hub);
    ctx.addRibbonIcon("layout-dashboard", "Open command center", open);
    ctx.addCommand({ id: "command-center-open", name: "Open command center", callback: open });
  },
};
