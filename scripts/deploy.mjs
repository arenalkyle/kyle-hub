import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VAR = "KYLE_HUB_VAULTS";
const LEGACY_VAR = "KYLE_TICKETS_VAULTS";
const termDir = path.join(root, "src", "modules", "term");

/** ';' separates vaults; on non-Windows ':' is accepted too (never on Windows: drive letters). */
export function parseVaults(raw, platform = process.platform) {
  const sep = platform === "win32" ? /;/ : /[;:]/;
  return raw.split(sep).map((v) => v.trim()).filter(Boolean);
}

/** Reads KYLE_HUB_VAULTS (falls back to the old KYLE_TICKETS_VAULTS) from env text. */
export function pickVaultsRaw(text) {
  const lines = text.split(/\r?\n/);
  const find = (name) => lines.find((l) => l.startsWith(`${name}=`))?.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");
  return find(VAR) || find(LEGACY_VAR) || "";
}

export function readVaults() {
  const envFile = path.join(root, ".env.local");
  if (!fs.existsSync(envFile)) {
    throw new Error(`.env.local not found at ${envFile}.\nCreate it with: ${VAR}=<vault path>[;<vault path>...]`);
  }
  const vaults = parseVaults(pickVaultsRaw(fs.readFileSync(envFile, "utf8")));
  if (vaults.length === 0) throw new Error(`${VAR} is empty in .env.local`);
  return vaults;
}

/** npm installs only this machine's prebuild; the deployed plugin also carries macOS and Linux x64 ones (Linux Obsidian in WSLg, ADR-0014). */
const EXTRA_PREBUILDS = ["darwin-arm64", "darwin-x64", "linux-x64"];

/** Fetch missing prebuild packages into node_modules (npm pack + tar). Best effort: a failure only warns. */
function fetchPrebuilds(lydell) {
  const version = JSON.parse(fs.readFileSync(path.join(lydell, "node-pty", "package.json"), "utf8")).version;
  for (const plat of EXTRA_PREBUILDS) {
    const dest = path.join(lydell, `node-pty-${plat}`);
    if (fs.existsSync(path.join(dest, "package.json"))) continue;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kh-pty-"));
    try {
      const pack = spawnSync("npm", ["pack", `@lydell/node-pty-${plat}@${version}`, "--pack-destination", tmp, "--silent"], { encoding: "utf8", shell: process.platform === "win32" });
      const tgz = pack.status === 0 && fs.readdirSync(tmp).find((f) => f.endsWith(".tgz"));
      if (!tgz) throw new Error(pack.stderr?.trim() || "npm pack failed");
      fs.mkdirSync(dest, { recursive: true });
      // Windows: the in-box bsdtar; Git Bash's GNU tar reads "C:" as a remote host.
      const tar = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
      const untar = spawnSync(tar, ["-xzf", tgz, "-C", dest, "--strip-components=1"], { cwd: tmp, encoding: "utf8" });
      if (untar.status !== 0) throw new Error(untar.stderr?.trim() || "tar failed");
    } catch (e) {
      fs.rmSync(dest, { recursive: true, force: true });
      console.warn(`warning: could not fetch @lydell/node-pty-${plat} (${e.message}); terminals won't start on that platform`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}

/** Runtime deps of the helper: @lydell/node-pty plus its platform package(s). */
function helperDeps() {
  const lydell = path.join(root, "node_modules", "@lydell");
  if (!fs.existsSync(path.join(lydell, "node-pty"))) throw new Error("@lydell/node-pty not installed; run npm install");
  fetchPrebuilds(lydell);
  return fs.readdirSync(lydell).filter((d) => d === "node-pty" || d.startsWith("node-pty-")).map((d) => path.join("@lydell", d));
}

export function deploy() {
  const vaults = readVaults();
  if (!fs.existsSync(path.join(root, "main.js"))) throw new Error("main.js missing; run npm run build first");
  const deps = helperDeps();
  for (const vault of vaults) {
    if (!fs.existsSync(vault)) throw new Error(`Vault not found: ${vault}`);
    const dest = path.join(vault, ".obsidian", "plugins", "kyle-hub");
    fs.mkdirSync(dest, { recursive: true });
    for (const f of ["main.js", "manifest.json", "styles.css"]) fs.copyFileSync(path.join(root, f), path.join(dest, f));
    for (const d of ["helper", "hooks"]) {
      fs.rmSync(path.join(dest, d), { recursive: true, force: true });
      fs.cpSync(path.join(termDir, d), path.join(dest, d), { recursive: true });
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
