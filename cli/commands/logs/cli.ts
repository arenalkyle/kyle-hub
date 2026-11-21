import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { defaultProjectsDir, FileLogService } from "../../../src/core/logs/service";
import type { ModelPrice, PriceTable, Profile, RepoMapEntry } from "../../../src/core/logs/types";
import { EXIT, KtError, type Io } from "../tickets/cli";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isProfile = (v: unknown): v is Profile => v === "home" || v === "work";
const USAGE = "kh logs ingest [--profile home|work]";

interface LogConfig {
  repoMap: RepoMapEntry[];
  denylist: string[];
  prices: PriceTable;
}

/** Reads `core.repos` and `core.logs` from the first configured vault's plugin data.json (read-only). */
export function readLogConfig(env: Record<string, string | undefined>): LogConfig {
  const empty: LogConfig = { repoMap: [], denylist: [], prices: {} };
  const vault = (env.KYLE_HUB_VAULTS ?? env.KYLE_TICKETS_VAULTS ?? "").split(";").map((s) => s.trim()).find((s) => s.length > 0);
  if (!vault) return empty;
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(path.join(vault, ".obsidian", "plugins", "kyle-hub", "data.json"), "utf8"));
  } catch {
    return empty;
  }
  const core = isObj(data) && isObj(data.core) ? data.core : {};
  const repos = isObj(core.repos) ? core.repos : {};
  const logs = isObj(core.logs) ? core.logs : {};
  const repoMap: RepoMapEntry[] = Object.entries(repos).flatMap(([name, v]) =>
    isObj(v) && typeof v.path === "string" && isProfile(v.profile) ? [{ name, path: v.path, profile: v.profile }] : [],
  );
  const denylist = Array.isArray(logs.denylist) ? logs.denylist.filter((x): x is string => typeof x === "string") : [];
  const prices: Record<string, ModelPrice> = {};
  if (isObj(logs.prices)) {
    for (const [model, p] of Object.entries(logs.prices)) {
      if (!isObj(p)) continue;
      const { input, output, cacheRead, cacheWrite } = p;
      if ([input, output, cacheRead, cacheWrite].every((n) => typeof n === "number")) {
        prices[model] = { input: input as number, output: output as number, cacheRead: cacheRead as number, cacheWrite: cacheWrite as number };
      }
    }
  }
  return { repoMap, denylist, prices };
}

/** `kh logs ingest [--profile home|work]`: incremental transcript ingest into %LOCALAPPDATA%\kyle-hub\<profile>\. */
export async function runLogs(argv: string[], io: Io): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub !== "ingest") throw new KtError(EXIT.usage, `Usage: ${USAGE}`);
  let profile: string | undefined;
  try {
    profile = parseArgs({ args: rest, options: { profile: { type: "string" } }, strict: true }).values.profile;
  } catch (e) {
    throw new KtError(EXIT.usage, `${(e as Error).message}. Usage: ${USAGE}`);
  }
  if (profile !== undefined && !isProfile(profile)) throw new KtError(EXIT.usage, `--profile must be home or work. Usage: ${USAGE}`);
  const cfg = readLogConfig(io.env);
  const svc = new FileLogService({ repoMap: cfg.repoMap, denylist: cfg.denylist, prices: cfg.prices, projectsDir: defaultProjectsDir(io.env) });
  const res = await svc.ingest(profile !== undefined && isProfile(profile) ? { profile } : {});
  io.out(`runs updated: ${res.runsUpdated}, records: ${res.records}, skipped: ${res.skipped}`);
  return EXIT.ok;
}
