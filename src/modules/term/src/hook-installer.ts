import fs from "node:fs";
import path from "node:path";

export const HOOK_MARKER = "kyle-hook.js";
/** Plugin folders whose hook entries count as ours: the old kyle-term plugin and kyle-hub itself. */
export const OWNER_DIRS = ["kyle-term", "kyle-hub"] as const;
export const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "Stop",
  "SubagentStart",
  "SubagentStop",
] as const;
const MATCHER_EVENTS = new Set<string>(["PreToolUse", "PostToolUse"]);

type Json = Record<string, unknown>;
interface Group { matcher?: string; hooks?: Array<{ command?: unknown }> }

/** A command that runs kyle-hook.js from a kyle-term or kyle-hub plugin folder. */
export const isOurs = (h: { command?: unknown }): boolean => {
  if (typeof h?.command !== "string") return false;
  const c = h.command.toLowerCase();
  return c.includes(HOOK_MARKER) && OWNER_DIRS.some((d) => c.includes(d));
};

/** Removes only our hook commands (kyle-term and kyle-hub); tidies empty groups, arrays and the hooks object. */
export function uninstallHooks(settings: Json): Json {
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) return settings;
  const out: Json = {};
  for (const [event, groups] of Object.entries(hooks as Json)) {
    if (!Array.isArray(groups)) { out[event] = groups; continue; }
    const kept: unknown[] = [];
    for (const g of groups as Group[]) {
      if (!g || !Array.isArray(g.hooks)) { kept.push(g); continue; }
      const rest = g.hooks.filter((h) => !isOurs(h));
      if (rest.length === g.hooks.length) kept.push(g);
      else if (rest.length > 0) kept.push({ ...g, hooks: rest });
    }
    if (kept.length > 0) out[event] = kept;
  }
  // Rebuild in the original key order so an untouched file stays byte-identical.
  const result: Json = {};
  for (const [k, v] of Object.entries(settings)) {
    if (k !== "hooks") result[k] = v;
    else if (Object.keys(out).length > 0) result.hooks = out;
  }
  return result;
}

/** Command line for one hook event (Windows: double-quoted path). */
export function hookCommand(scriptPath: string, event: string): string {
  return `node "${scriptPath}" ${event}`;
}

/** Adds kyle-hub's entries, replacing any previous ones (kyle-term or kyle-hub) so repeated installs never duplicate. */
export function installHooks(settings: Json, scriptPath: string): Json {
  const clean = uninstallHooks(settings);
  const hooks: Json = { ...((clean.hooks as Json | undefined) ?? {}) };
  for (const event of HOOK_EVENTS) {
    const group: Json = {
      ...(MATCHER_EVENTS.has(event) ? { matcher: "*" } : {}),
      hooks: [{ type: "command", command: hookCommand(scriptPath, event), timeout: 5 }],
    };
    const existing = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    hooks[event] = [...existing, group];
  }
  return { ...clean, hooks };
}

export interface HookPlan { next: Json; changed: boolean }

const same = (a: Json, b: Json): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Pure: what `settings.json` becomes after Install hooks (`changed` is false when already installed). */
export function planHookInstall(current: Json, hookPath: string): HookPlan {
  const next = installHooks(current, hookPath);
  return { next, changed: !same(next, current) };
}

/** Pure: what `settings.json` becomes after Uninstall hooks. */
export function planHookUninstall(current: Json): HookPlan {
  const next = uninstallHooks(current);
  return { next, changed: !same(next, current) };
}

export interface ApplyResult { ok: boolean; changed: boolean; message: string; backup?: string }

export type LoadedSettings =
  | { ok: true; raw: string | null; current: Json }
  | { ok: false; message: string };

const stamp = (d: Date): string => d.toISOString().replace(/[:.]/g, "-");

/** Reads the settings file; a missing or empty file is `{}`. An unparseable file is an error (never overwritten). */
export function loadSettingsFile(file: string): LoadedSettings {
  let raw: string | null = null;
  try { raw = fs.readFileSync(file, "utf8"); } catch { raw = null; }
  let current: Json = {};
  if (raw !== null && raw.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      current = parsed as Json;
    } catch (e) {
      return { ok: false, message: `${file} is not valid JSON (${(e as Error).message}); left untouched.` };
    }
  }
  return { ok: true, raw, current };
}

/** Backs up the existing file (byte for byte), then writes `next`. */
export function writeSettingsFile(file: string, raw: string | null, next: Json, mode: "install" | "uninstall", now = new Date()): ApplyResult {
  try {
    let backup: string | undefined;
    if (raw !== null) {
      backup = `${file}.kyle-hub-backup-${stamp(now)}`;
      fs.writeFileSync(backup, raw);
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
    return {
      ok: true, changed: true, backup,
      message: `${mode === "install" ? "Hooks installed" : "Hooks removed"}${backup ? `; backup: ${path.basename(backup)}` : ""}.`,
    };
  } catch (e) {
    return { ok: false, changed: false, message: `Could not write ${file}: ${(e as Error).message}` };
  }
}

/** Load, plan and write in one step (no preview). The plugin command previews first and calls the pieces itself. */
export function applyToFile(file: string, mode: "install" | "uninstall", scriptPath: string, now = new Date()): ApplyResult {
  const loaded = loadSettingsFile(file);
  if (!loaded.ok) return { ok: false, changed: false, message: loaded.message };
  const plan = mode === "install" ? planHookInstall(loaded.current, scriptPath) : planHookUninstall(loaded.current);
  if (loaded.raw !== null && !plan.changed) {
    return { ok: true, changed: false, message: mode === "install" ? "Hooks already installed." : "No kyle-hub or kyle-term hooks found." };
  }
  if (loaded.raw === null && mode === "uninstall") return { ok: true, changed: false, message: "No settings file; nothing to remove." };
  return writeSettingsFile(file, loaded.raw, plan.next, mode, now);
}
