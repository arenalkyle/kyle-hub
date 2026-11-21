import { useCallback, useSyncExternalStore } from "react";
import type { Issue, Project, Settings } from "../core/types";
import { usePlugin } from "../views/PluginContext";
import type { IssueStore } from "./IssueStore";

function useStoreSelector<T>(select: (s: IssueStore) => T): T {
  const { store } = usePlugin();
  const subscribe = useCallback((cb: () => void) => store.on("change", cb), [store]);
  return useSyncExternalStore(subscribe, () => select(store));
}

export const useIssues = (): readonly Issue[] => useStoreSelector((s) => s.getIssues());
export const useProjects = (): readonly Project[] => useStoreSelector((s) => s.getProjects());
export const useIssue = (id: string): Issue | undefined => useStoreSelector((s) => s.getIssue(id));

/** Current settings object; changes identity whenever `plugin.updateSettings` runs. */
export function useSettings(): Settings {
  const plugin = usePlugin();
  const subscribe = useCallback((cb: () => void) => plugin.onSettingsChange(cb), [plugin]);
  return useSyncExternalStore(subscribe, () => plugin.data.settings);
}
