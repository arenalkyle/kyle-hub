import { spawnSync } from "node:child_process";

export interface NodeCheck {
  ok: boolean;
  path: string;
  message?: string;
}

/** Resolve the Node binary: configured path if set, else `node` on PATH. Requires Node >= 18. */
export function resolveNode(configured: string): NodeCheck {
  const path = configured.trim() || "node";
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
