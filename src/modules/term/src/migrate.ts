import type { ModuleData } from "../../../core";
import { normalizeTerm, TERM_DEFAULTS } from "./schema";

/** The slice of `app.vault.adapter` the migration needs. */
export interface LegacyAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
}

const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  );

/** True while the `term` namespace still equals its defaults (nothing saved or migrated yet). */
export function isUntouched(ns: ModuleData): boolean {
  const { enabled: _enabled, ...rest } = ns;
  return canon(rest) === canon(TERM_DEFAULTS);
}

/**
 * First-load import of the old kyle-term `data.json` (settings plus saved sessions) into `ns`
 * (the `modules.term` object, mutated). Runs only while `ns` is untouched and the old file exists;
 * writes `data.json.bak` once. Returns true when `ns` changed (caller saves). Re-running is a no-op
 * because `ns` is no longer untouched.
 */
export async function migrateLegacyTerm(adapter: LegacyAdapter, configDir: string, ns: ModuleData): Promise<boolean> {
  if (!isUntouched(ns)) return false;
  const file = `${configDir}/plugins/kyle-term/data.json`;
  if (!(await adapter.exists(file))) return false;
  const text = await adapter.read(file);
  let old: unknown;
  try {
    old = JSON.parse(text);
  } catch {
    return false;
  }
  if (typeof old !== "object" || old === null || Array.isArray(old)) return false;
  if (!(await adapter.exists(`${file}.bak`))) await adapter.write(`${file}.bak`, text);
  const { enabled: _enabled, ...legacy } = old as Record<string, unknown>;
  Object.assign(ns, structuredClone(TERM_DEFAULTS), legacy);
  normalizeTerm(ns);
  return true;
}
