import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultDisplay, mergeDisplay, type DisplayState } from "../../../../../core/domain/display";
import { mergeFilters, type Filter } from "../../../../../core/domain/filters";
import { usePlugin } from "../PluginContext";

const SAVE_DELAY_MS = 400;

function viewEntry(views: Record<string, unknown>, viewId: string): Record<string, unknown> {
  const v = views[viewId];
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Per-sidebar-view state, stored at `data.views[viewId].display` / `.filters`; saves are debounced. */
export function useViewState(viewId: string) {
  const plugin = usePlugin();
  const [tick, setTick] = useState(0);
  const timer = useRef<number | null>(null);

  const display = useMemo(
    () => mergeDisplay(viewEntry(plugin.data.views, viewId).display),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plugin, viewId, tick],
  );
  const filters = useMemo(
    () => mergeFilters(viewEntry(plugin.data.views, viewId).filters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plugin, viewId, tick],
  );

  // Flush a pending save when the view unmounts.
  useEffect(
    () => () => {
      if (timer.current === null) return;
      window.clearTimeout(timer.current);
      timer.current = null;
      void plugin.savePluginData();
    },
    [plugin],
  );

  const save = useCallback(
    (patch: Record<string, unknown>) => {
      plugin.data.views[viewId] = { ...viewEntry(plugin.data.views, viewId), ...patch };
      setTick((t) => t + 1);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        void plugin.savePluginData();
      }, SAVE_DELAY_MS);
    },
    [plugin, viewId],
  );

  const setDisplay = useCallback((next: DisplayState) => save({ display: next }), [save]);
  const setFilters = useCallback((next: Filter[]) => save({ filters: next }), [save]);
  const reset = useCallback(() => setDisplay(defaultDisplay()), [setDisplay]);
  return { display, setDisplay, filters, setFilters, reset };
}
