import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { dataDir } from "../paths";
import { PROFILES } from "../logs/types";
import { checkCleanupPeriod, checkHooks, checkLogDirs, checkScheduledTask, type Check } from "./doctor";
import { buildSchtasksArgs } from "./schedule";

export type SchtasksRunner = (argv: string[]) => { status: number | null; stdout: string };

export const defaultSchtasks: SchtasksRunner = (argv) => {
  const r = spawnSync("schtasks.exe", argv, { encoding: "utf8", windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? "" };
};

/** Probes that a directory accepts a write (creates it if missing), then removes the probe file. */
function writable(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.doctor-${process.pid}`);
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/** Reads the real environment (settings.json, the task, log dirs) and runs every doctor check. */
export function runDoctorChecks(env: Record<string, string | undefined>, homedir: string, schtasks: SchtasksRunner = defaultSchtasks): Check[] {
  const settingsFile = path.join(homedir, ".claude", "settings.json");
  const settingsText = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, "utf8") : undefined;
  const task = schtasks(buildSchtasksArgs("query"));
  const dirs = PROFILES.map((p) => {
    const d = dataDir(p, { env, homedir: () => homedir });
    return { path: d, writable: writable(d) };
  });
  return [checkCleanupPeriod(settingsText), checkHooks(settingsText), checkScheduledTask(task.status === 0), checkLogDirs(dirs)];
}
