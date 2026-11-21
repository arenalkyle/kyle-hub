import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function readVaults() {
  const envFile = path.join(root, ".env.local");
  if (!fs.existsSync(envFile)) {
    throw new Error(
      `.env.local not found at ${envFile}.\nCreate it with: KYLE_TERM_VAULTS=<vault path>[;<vault path>...]`,
    );
  }
  const line = fs.readFileSync(envFile, "utf8").split(/\r?\n/).find((l) => l.startsWith("KYLE_TERM_VAULTS="));
  const raw = line?.slice("KYLE_TERM_VAULTS=".length).trim().replace(/^["']|["']$/g, "") ?? "";
  // ';' separates vaults; on macOS/Linux ':' is accepted too.
  const sep = process.platform === "win32" ? /;/ : /[;:]/;
  const vaults = raw.split(sep).map((v) => v.trim()).filter(Boolean);
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
    for (const dep of deps) {
      const target = path.join(dest, "node_modules", dep);
      fs.rmSync(target, { recursive: true, force: true });
      fs.cpSync(path.join(root, "node_modules", dep), target, { recursive: true });
    }
    console.log(`deployed -> ${dest}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { deploy(); } catch (e) { console.error(`deploy failed: ${e.message}`); process.exit(1); }
}
