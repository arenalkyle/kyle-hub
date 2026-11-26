import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export interface NodeCheck {
  ok: boolean;
  path: string;
  message?: string;
}

/** Apps launched from the macOS Dock get a minimal PATH, so `node` from Homebrew or the installer isn't on it. */
const UNIX_NODE_PATHS = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"];

/** Resolve the Node binary: configured path if set, else `node` on PATH (or a usual install location). Requires Node >= 18. */
export function resolveNode(configured: string, platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean = existsSync): NodeCheck {
  const path = configured.trim() || (platform === "win32" ? undefined : UNIX_NODE_PATHS.find(exists)) || "node";
  const r = spawnSync(path, ["-p", "process.versions.node"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
  if (r.error || r.status !== 0) {
    return { ok: false, path, message: `Node.js not found (tried "${path}"). Install Node 18+ or set the Node path in kyle-hub settings.` };
  }
  const major = Number.parseInt(r.stdout.trim().split(".")[0] ?? "", 10);
  if (!Number.isFinite(major) || major < 18) {
    return { ok: false, path, message: `Node ${r.stdout.trim()} is too old. Install Node 18+ or set the Node path in kyle-hub settings.` };
  }
  return { ok: true, path };
}
