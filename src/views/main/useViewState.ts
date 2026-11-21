import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultDisplay, mergeDisplay, type DisplayState } from "../../core/display";
import { usePlugin } from "../PluginContext";

const SAVE_DELAY_MS = 400;

function viewEntry(views: Record<string, unknown>, viewId: string): Record<string, unknown> {
  const v = views[viewId];
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Per-sidebar-view display state, stored at `data.views[viewId].display`; saves are debounced. */
export function useViewState(viewId: string) {
  const plugin = usePlugin();
  const [tick, setTick] = useState(0);
  const timer = useRef<number | null>(null);

  const display = useMemo(
    () => mergeDisplay(viewEntry(plugin.data.views, viewId).display),
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

  const setDisplay = useCallback(
    (next: DisplayState) => {
      plugin.data.views[viewId] = { ...viewEntry(plugin.data.views, viewId), display: next };
      setTick((t) => t + 1);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        void plugin.savePluginData();
      }, SAVE_DELAY_MS);
    },
    [plugin, viewId],
  );

  const reset = useCallback(() => setDisplay(defaultDisplay()), [setDisplay]);
  return { display, setDisplay, reset };
}
