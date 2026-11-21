import type { HubModule } from "../../core";
import TermHost from "./src/main";
import { migrateLegacyTerm } from "./src/migrate";
import { termSettings } from "./src/schema";

export { termSettings };

let host: TermHost | null = null;
let unregister: (() => void) | null = null;

export const termModule: HubModule = {
  id: "term",
  async load(hub, ctx) {
    try {
      if (await migrateLegacyTerm(hub.app.vault.adapter, hub.app.vault.configDir, hub.settings.module("term"))) await hub.save();
    } catch (e) {
      console.error("kyle-hub: kyle-term settings migration failed", e);
    }
    host = new TermHost(hub, ctx);
    hub.services.register("sessions", await host.start());
    hub.services.register("attention", host.attentionService());
    hub.services.register("retro", host.retroService());
    unregister = () => {
      hub.services.unregister("retro");
      hub.services.unregister("sessions");
      hub.services.unregister("attention");
    };
  },
  unload() {
    unregister?.();
    unregister = null;
    host?.stop();
    host = null;
  },
};
