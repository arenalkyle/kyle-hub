import { useCallback, useMemo, useSyncExternalStore } from "react";
import { parsePrUrl, type PrInfo } from "../core/pr";
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

export const useStoreReady = (): boolean => useStoreSelector((s) => s.isReady());

export interface PrEntry {
  url: string;
  /** Canonical github.com URL, or null when the stored text is not a PR URL. */
  canonical: string | null;
  /** Live info once fetched; undefined means show a plain link. */
  info?: PrInfo;
}

/** Stored PR urls joined with cached live state; re-renders when the PR cache changes. */
export function usePrs(urls: readonly string[]): PrEntry[] {
  const { prs } = usePlugin();
  const subscribe = useCallback((cb: () => void) => prs.subscribe(cb), [prs]);
  const version = useSyncExternalStore(subscribe, () => prs.getVersion());
  const key = urls.join("\n");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => urls.map((url) => {
    const canonical = parsePrUrl(url)?.url ?? null;
    return { url, canonical, info: canonical ? prs.get(canonical) : undefined };
  }), [prs, key, version]);
}
