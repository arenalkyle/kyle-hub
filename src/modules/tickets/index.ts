import { createTicketService } from "./src/service";
import type { HubModule } from "../../core";
import { ticketsSettings } from "./src/schema";
import TicketsHost from "./src/main";
import { migrateLegacyTickets } from "./src/migrate";

export { ticketsSettings };

let host: TicketsHost | null = null;
let unregister: (() => void) | null = null;

export const ticketsModule: HubModule = {
  id: "tickets",
  async load(hub, ctx) {
    const adapter = hub.app.vault.adapter;
    try {
      if (await migrateLegacyTickets(adapter, hub.app.vault.configDir, hub.settings.module("tickets"))) await hub.save();
    } catch (e) {
      console.error("kyle-hub: kyle-tickets settings migration failed", e);
    }
    host = new TicketsHost(hub, ctx);
    hub.services.register("tickets", createTicketService(host.store));
    unregister = () => hub.services.unregister("tickets");
    host.start();
  },
  unload() {
    unregister?.();
    unregister = null;
    host?.stop();
    host = null;
  },
};
