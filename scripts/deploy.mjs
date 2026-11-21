import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** ';' separates vaults; on macOS/Linux ':' is accepted too (never on Windows: drive letters). */
export function parseVaults(raw, platform) {
  const sep = platform === "win32" ? /;/ : /[;:]/;
  return raw.split(sep).map((v) => v.trim()).filter(Boolean);
}

export function readVaults() {
  const envFile = path.join(root, ".env.local");
  if (!fs.existsSync(envFile)) {
    throw new Error(
      `.env.local not found at ${envFile}.\nCreate it with: KYLE_TERM_VAULTS=<vault path>[;<vault path>...]`,
    );
  }
  const line = fs.readFileSync(envFile, "utf8").split(/\r?\n/).find((l) => l.startsWith("KYLE_TERM_VAULTS="));
  const raw = line?.slice("KYLE_TERM_VAULTS=".length).trim().replace(/^["']|["']$/g, "") ?? "";
  const vaults = parseVaults(raw, process.platform);
  if (vaults.length === 0) throw new Error("KYLE_TERM_VAULTS is empty in .env.local");
  return vaults;
}

/** Runtime deps of the helper: @lydell/node-pty plus its platform package(s). */
function helperDeps() {
  const nm = path.join(root, "node_modules");
  const out = [];
  const lydell = path.join(nm, "@lydell");
  if (!fs.existsSync(path.join(lydell, "node-pty"))) throw new Error("@lydell/node-pty not installed; run npm install");
  for (const d of fs.readdirSync(lydell)) {
    if (d === "node-pty" || d.startsWith("node-pty-")) out.push(path.join("@lydell", d));
  }
  return out;
}

export function deploy() {
  const vaults = readVaults();
  if (!fs.existsSync(path.join(root, "main.js"))) throw new Error("main.js missing; run npm run build first");
  const deps = helperDeps();
  for (const vault of vaults) {
    if (!fs.existsSync(vault)) throw new Error(`Vault not found: ${vault}`);
    const dest = path.join(vault, ".obsidian", "plugins", "kyle-term");
    fs.mkdirSync(dest, { recursive: true });
    for (const f of ["main.js", "manifest.json", "styles.css"]) fs.copyFileSync(path.join(root, f), path.join(dest, f));
    for (const d of ["helper", "hooks"]) {
      fs.rmSync(path.join(dest, d), { recursive: true, force: true });
      fs.cpSync(path.join(root, d), path.join(dest, d), { recursive: true });
    }
    for (const dep of deps) syncDir(path.join(root, "node_modules", dep), path.join(dest, "node_modules", dep));
    console.log(`deployed -> ${dest}`);
  }
}

/**
 * Copy a folder file by file, skipping files that are already identical (same size and mtime).
 * While Obsidian runs, the helper holds native `.node` files open (EPERM on Windows); those are
 * left alone if unchanged, and reported if they differ (restart Obsidian, then deploy again).
 */
function syncDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) { syncDir(s, d); continue; }
    const ss = fs.statSync(s);
    const ds = fs.existsSync(d) ? fs.statSync(d) : null;
    if (ds && ds.size === ss.size && Math.abs(ds.mtimeMs - ss.mtimeMs) < 2000) continue;
    try {
      fs.copyFileSync(s, d);
      fs.utimesSync(d, ss.atime, ss.mtime);
    } catch (err) {
      if (err.code !== "EPERM" && err.code !== "EBUSY") throw err;
      console.warn(`skipped locked file (close Obsidian and redeploy if it changed): ${d}`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { deploy(); } catch (e) { console.error(`deploy failed: ${e.message}`); process.exit(1); }
}
