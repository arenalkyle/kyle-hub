import type { ModuleSettingsDef } from "../../../core";
import { defaultData } from "./data";

/** The `tickets` namespace is the old kyle-tickets `data.json` shape (schemaVersion 1). */
export const ticketsSettings: ModuleSettingsDef = { id: "tickets", defaults: defaultData() as unknown as Record<string, unknown> };
