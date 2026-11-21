import fs from "node:fs";
import path from "node:path";

export const HOOK_MARKER = "kyle-hook.js";
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

const isOurs = (h: { command?: unknown }): boolean => typeof h?.command === "string" && h.command.includes(HOOK_MARKER);

/** Removes only kyle-term's hook commands; tidies empty groups, arrays and the hooks object. */
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
  const others: Json = { ...settings };
  delete others.hooks;
  return Object.keys(out).length > 0 ? { ...others, hooks: out } : others;
}

/** Command line for one hook event. Windows keeps double quotes; POSIX single-quotes (spaces, `$`, quotes safe). */
export function hookCommand(scriptPath: string, event: string, platform: string = process.platform): string {
  if (platform === "win32") return `node "${scriptPath}" ${event}`;
  return `node '${scriptPath.replace(/'/g, `'\\''`)}' ${event}`;
}

/** Adds kyle-term's entries (replacing any previous ones, so repeated installs never duplicate). */
export function installHooks(settings: Json, scriptPath: string, platform: string = process.platform): Json {
  const clean = uninstallHooks(settings);
  const hooks: Json = { ...((clean.hooks as Json | undefined) ?? {}) };
  for (const event of HOOK_EVENTS) {
    const group: Json = {
      ...(MATCHER_EVENTS.has(event) ? { matcher: "*" } : {}),
      hooks: [{ type: "command", command: hookCommand(scriptPath, event, platform), timeout: 5 }],
    };
    const existing = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    hooks[event] = [...existing, group];
  }
  return { ...clean, hooks };
}

export interface ApplyResult { ok: boolean; changed: boolean; message: string; backup?: string }

const stamp = (d: Date): string => d.toISOString().replace(/[:.]/g, "-");

/** Reads (or creates) the settings file, backs it up, and applies install/uninstall. Never overwrites an unparseable file. */
export function applyToFile(file: string, mode: "install" | "uninstall", scriptPath: string, now = new Date()): ApplyResult {
  let raw: string | null = null;
  try { raw = fs.readFileSync(file, "utf8"); } catch { raw = null; }
  let current: Json = {};
  if (raw !== null && raw.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      current = parsed as Json;
    } catch (e) {
      return { ok: false, changed: false, message: `${file} is not valid JSON (${(e as Error).message}); left untouched.` };
    }
  }
  const next = mode === "install" ? installHooks(current, scriptPath) : uninstallHooks(current);
  if (raw !== null && JSON.stringify(next) === JSON.stringify(current)) {
    return { ok: true, changed: false, message: mode === "install" ? "Hooks already installed." : "No kyle-term hooks found." };
  }
  if (raw === null && mode === "uninstall") return { ok: true, changed: false, message: "No settings file; nothing to remove." };
  try {
    let backup: string | undefined;
    if (raw !== null) {
      backup = `${file}.kyle-term-backup-${stamp(now)}`;
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
