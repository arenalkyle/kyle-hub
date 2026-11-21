import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VAR = "KYLE_TICKETS_VAULTS";

/** ';' separates vaults (':' would break Windows drive letters). */
export function parseVaults(raw) {
  return raw.split(";").map((v) => v.trim()).filter(Boolean);
}

export function readVaults() {
  const envFile = path.join(root, ".env.local");
  if (!fs.existsSync(envFile)) {
    throw new Error(`.env.local not found at ${envFile}.\nCreate it with: ${VAR}=<vault path>[;<vault path>...]`);
  }
  const line = fs.readFileSync(envFile, "utf8").split(/\r?\n/).find((l) => l.startsWith(`${VAR}=`));
  const raw = line?.slice(VAR.length + 1).trim().replace(/^["']|["']$/g, "") ?? "";
  const vaults = parseVaults(raw);
  if (vaults.length === 0) throw new Error(`${VAR} is empty in .env.local`);
  return vaults;
}

export function deploy() {
  const vaults = readVaults();
  if (!fs.existsSync(path.join(root, "main.js"))) throw new Error("main.js missing; run npm run build first");
  for (const vault of vaults) {
    if (!fs.existsSync(vault)) throw new Error(`Vault not found: ${vault}`);
    const dest = path.join(vault, ".obsidian", "plugins", "kyle-tickets");
    fs.mkdirSync(dest, { recursive: true });
    for (const f of ["main.js", "manifest.json", "styles.css"]) fs.copyFileSync(path.join(root, f), path.join(dest, f));
    console.log(`deployed -> ${dest}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { deploy(); } catch (e) { console.error(`deploy failed: ${e.message}`); process.exit(1); }
}
