export type CheckStatus = "ok" | "warn" | "fail";

export interface Check {
  id: string;
  status: CheckStatus;
  message: string;
}

/** Claude Code keeps transcripts this many days; ingest runs every 30 minutes, so 7 days leaves a wide margin. */
export const MIN_CLEANUP_DAYS = 7;
/** Claude Code's default when `cleanupPeriodDays` is unset. */
export const CLAUDE_DEFAULT_CLEANUP_DAYS = 30;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** `settingsText` is the raw `~/.claude/settings.json`, or undefined when the file does not exist. */
export function checkCleanupPeriod(settingsText: string | undefined): Check {
  const id = "cleanupPeriodDays";
  if (settingsText === undefined) {
    return { id, status: "warn", message: `settings.json not found; set "cleanupPeriodDays": ${MIN_CLEANUP_DAYS} or more in ~/.claude/settings.json` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(settingsText);
  } catch {
    return { id, status: "warn", message: "settings.json is not valid JSON; cannot read cleanupPeriodDays" };
  }
  const value = isObj(parsed) ? parsed.cleanupPeriodDays : undefined;
  if (value === undefined) {
    return { id, status: "warn", message: `cleanupPeriodDays not set (Claude Code default ${CLAUDE_DEFAULT_CLEANUP_DAYS}); add "cleanupPeriodDays": ${MIN_CLEANUP_DAYS} or more` };
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { id, status: "warn", message: `cleanupPeriodDays must be a number of days, found ${JSON.stringify(value)}` };
  }
  if (value < MIN_CLEANUP_DAYS) {
    return { id, status: "warn", message: `cleanupPeriodDays is ${value}; transcripts vanish before ingest. Set it to ${MIN_CLEANUP_DAYS} or more` };
  }
  return { id, status: "ok", message: `cleanupPeriodDays is ${value}` };
}

/**
 * kyle-hook belongs in each vault's `.claude/settings.local.json` (LOCK-63). `vaultTexts` holds the raw file of every
 * known vault (undefined when missing). ok = registered in a vault and gone from global settings; warn otherwise.
 */
export function checkHooks(globalText: string | undefined, vaultTexts: ReadonlyArray<string | undefined> = []): Check {
  const id = "hooks";
  const inGlobal = globalText !== undefined && globalText.includes("kyle-hook");
  const inVault = vaultTexts.some((t) => t !== undefined && t.includes("kyle-hook"));
  if (inGlobal) {
    return { id, status: "warn", message: "kyle-hook is still in ~/.claude/settings.json (stale); run the hook installer from the term settings to move it into the vault" };
  }
  return inVault
    ? { id, status: "ok", message: "kyle-hook is registered in the vault's .claude/settings.local.json" }
    : { id, status: "warn", message: "kyle-hook is not registered in the vault's .claude/settings.local.json; run the hook installer from the term settings" };
}

export function checkScheduledTask(exists: boolean): Check {
  return exists
    ? { id: "scheduledTask", status: "ok", message: "kyle-hub-maintain task is registered" }
    : { id: "scheduledTask", status: "warn", message: "kyle-hub-maintain task is missing; run kh schedule install --yes" };
}

export function checkLogDirs(dirs: readonly { path: string; writable: boolean }[]): Check {
  const bad = dirs.filter((d) => !d.writable);
  return bad.length === 0
    ? { id: "logDirs", status: "ok", message: `log dirs writable (${dirs.length})` }
    : { id: "logDirs", status: "fail", message: `not writable: ${bad.map((d) => d.path).join(", ")}` };
}
