import { FileLogService, type LogServiceOptions } from "./service";
import { accountsOf } from "../accounts";
import { PROFILES, type PriceTable, type Profile, type RepoMapEntry } from "./types";

/** The `core` settings section as stored in data.json (`repos`, `logs`); unknown or invalid entries are ignored. */
export interface CoreSettingsLike {
  repos?: Record<string, { path?: unknown; profile?: unknown }>;
  logs?: { denylist?: unknown; prices?: unknown; retentionDays?: unknown; packRetentionDays?: unknown; spoolDays?: unknown };
}

const isProfile = (v: unknown): v is Profile => typeof v === "string" && (PROFILES as readonly string[]).includes(v);

/** Builds the hub's LogService from core settings; `dataRoot` overrides the default `%LOCALAPPDATA%` location (tests). */
export function logServiceFromSettings(core: CoreSettingsLike, dataRoot?: LogServiceOptions["dataRoot"]): FileLogService {
  const repoMap: RepoMapEntry[] = Object.entries(core.repos ?? {}).flatMap(([name, v]) =>
    typeof v.path === "string" && isProfile(v.profile) ? [{ name, path: v.path, profile: v.profile }] : [],
  );
  const logs = core.logs ?? {};
  const denylist = Array.isArray(logs.denylist) ? logs.denylist.filter((x): x is string => typeof x === "string") : [];
  const prices: PriceTable = typeof logs.prices === "object" && logs.prices !== null ? (logs.prices as PriceTable) : {};
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const retention = { retentionDays: num(logs.retentionDays), packRetentionDays: num(logs.packRetentionDays), spoolDays: num(logs.spoolDays) };
  return new FileLogService({
    accounts: () => accountsOf(core).list.map((a) => ({ id: a.id, configDir: a.configDir })),
    repoMap,
    denylist,
    prices,
    dataRoot,
    retention: Object.fromEntries(Object.entries(retention).filter(([, v]) => v !== undefined)),
  });
}
