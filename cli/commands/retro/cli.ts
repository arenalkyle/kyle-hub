import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { dataDir } from "../../../src/core/paths";
import { PROFILES, type Profile } from "../../../src/core/logs/types";
import { detect, gatherInput, readRetroState, resolveRetroConfig, retroFile } from "../../../src/modules/term/retro";
import { EXIT, KtError, type Io } from "../tickets/cli";
import { serviceFor } from "../logs/cli";

const USAGE = "kh retro detect [--profile home|work] [--json]";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `term.retro` from the first configured vault's plugin data.json (read-only); defaults when absent. */
function readRetroSettings(env: Record<string, string | undefined>): unknown {
  const vault = (env.KYLE_HUB_VAULTS ?? env.KYLE_TICKETS_VAULTS ?? "").split(";").map((s) => s.trim()).find((s) => s.length > 0);
  if (!vault) return undefined;
  try {
    const data: unknown = JSON.parse(fs.readFileSync(path.join(vault, ".obsidian", "plugins", "kyle-hub", "data.json"), "utf8"));
    return isObj(data) && isObj(data.term) ? data.term.retro : undefined;
  } catch {
    return undefined;
  }
}

/** `kh retro detect`: dry run. Prints clusters; never writes tickets, retro.json or the index. */
export async function runRetro(argv: string[], io: Io): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub !== "detect") throw new KtError(EXIT.usage, `Usage: ${USAGE}`);
  let opts: { profile?: string; json?: boolean };
  try {
    const r = parseArgs({ args: rest, options: { profile: { type: "string" }, json: { type: "boolean" } }, strict: true, allowPositionals: false });
    opts = r.values as typeof opts;
  } catch (e) {
    throw new KtError(EXIT.usage, `${(e as Error).message}. Usage: ${USAGE}`);
  }
  if (opts.profile !== undefined && !(PROFILES as readonly string[]).includes(opts.profile)) {
    throw new KtError(EXIT.usage, `--profile must be home or work. Usage: ${USAGE}`);
  }
  const profiles: Profile[] = opts.profile !== undefined ? [opts.profile as Profile] : [...PROFILES];
  const config = resolveRetroConfig(readRetroSettings(io.env));
  const svc = serviceFor(io);
  const report = [];
  for (const profile of profiles) {
    const state = readRetroState(retroFile(dataDir(profile, { env: io.env, homedir: os.homedir })));
    const input = await gatherInput(svc, { config, watermark: state.watermark, profile });
    const result = detect(input);
    report.push({ profile, watermark: state.watermark ?? null, runs: input.runs.length, signals: result.signals.length, clusters: result.clusters });
  }
  if (opts.json) {
    io.out(JSON.stringify(report, null, 2));
    return EXIT.ok;
  }
  for (const r of report) {
    io.out(`[${r.profile}] watermark=${r.watermark ?? "none"} runs=${r.runs} signals=${r.signals} clusters=${r.clusters.length}`);
    for (const c of r.clusters.slice(0, 50)) io.out(`  ${c.count}x ${c.sessions.length} sessions  ${c.signature}`);
  }
  return EXIT.ok;
}
