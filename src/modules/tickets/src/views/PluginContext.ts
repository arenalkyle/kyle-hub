import { createContext, useContext } from "react";
import type KyleTicketsPlugin from "../main";

export const PluginContext = createContext<KyleTicketsPlugin | null>(null);

export function usePlugin(): KyleTicketsPlugin {
  const p = useContext(PluginContext);
  if (!p) throw new Error("PluginContext missing");
  return p;
}
