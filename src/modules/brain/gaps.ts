import fs from "node:fs";
import path from "node:path";
import type { GapsService } from "../../core";
import { parseGapsReport, type GapsReport } from "../../core/domain/gaps";
import { GAPS_DIR } from "../../core/gaps/gather";

const GAPS_FILE = "latest.json";
const DEBOUNCE_MS = 300;

/** The report at `<vault>/.kyle-hub/gaps/latest.json`, or undefined when it is missing or invalid. */
export function readGapsReport(vaultRoot: string): GapsReport | undefined {
  try {
    return parseGapsReport(JSON.parse(fs.readFileSync(path.join(vaultRoot, GAPS_DIR, GAPS_FILE), "utf8")));
  } catch {
    return undefined;
  }
}

/**
 * Reads the gaps report and watches its folder with fs.watch: Obsidian's vault events skip dot-folders.
 * While the folder is missing it watches the nearest existing ancestor and re-arms as deeper folders appear.
 * Call `dispose` on unload.
 */
export function createGapsService(vaultRoot: string | undefined): { service: GapsService; dispose(): void } {
  const listeners = new Set<() => void>();
  const gapsDir = vaultRoot === undefined ? undefined : path.join(vaultRoot, GAPS_DIR);
  let watcher: fs.FSWatcher | undefined;
  let watched: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const notify = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      for (const cb of [...listeners]) cb();
    }, DEBOUNCE_MS);
  };

  const arm = (): void => {
    if (closed || vaultRoot === undefined || gapsDir === undefined) return;
    const target = [gapsDir, path.dirname(gapsDir), vaultRoot].find((d) => fs.existsSync(d));
    if (target === undefined || target === watched) return;
    watcher?.close();
    watcher = undefined;
    watched = undefined;
    try {
      // A failed watcher is dropped, not re-armed, so an error cannot loop; the report still reads on demand.
      const w = fs.watch(target, () => (target === gapsDir ? notify() : arm()));
      w.on("error", () => {
        if (watcher === w) {
          watcher = undefined;
          watched = undefined;
        }
        w.close();
      });
      watcher = w;
      watched = target;
    } catch {
      return;
    }
    if (target === gapsDir) notify();
  };

  arm();
  const service: GapsService = {
    read: () => (vaultRoot === undefined ? undefined : readGapsReport(vaultRoot)),
    onChange: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
  return {
    service,
    dispose: () => {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      watcher?.close();
      watcher = undefined;
      watched = undefined;
      listeners.clear();
    },
  };
}
