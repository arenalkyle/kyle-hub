import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { dataDir } from "../../../src/core/paths";
import { defaultProjectsDir, FileLogService } from "../../../src/core/logs/service";
import type { RetentionPolicy } from "../../../src/core/logs/retention";
import type { ModelPrice, PriceTable, Profile, RepoMapEntry } from "../../../src/core/logs/types";
import { EXIT, KtError, type Io } from "../tickets/cli";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isProfile = (v: unknown): v is Profile => v === "home" || v === "work";
const USAGE = "kh logs <ingest [--profile home|work] | runs [--since <date>] [--ticket <id>] [--repo <name>] [--json] | show <runId> | sweep [--dry-run]>";

interface LogConfig {
  repoMap: RepoMapEntry[];
  denylist: string[];
  prices: PriceTable;
  retention: Partial<RetentionPolicy>;
}

/** Reads `core.repos` and `core.logs` from the first configured vault's plugin data.json (read-only). */
export function readLogConfig(env: Record<string, string | undefined>): LogConfig {
  const empty: LogConfig = { repoMap: [], denylist: [], prices: {}, retention: {} };
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
  const retention: Partial<RetentionPolicy> = {};
  for (const k of ["retentionDays", "packRetentionDays", "spoolDays"] as const) {
    if (typeof logs[k] === "number") retention[k] = logs[k] as number;
  }
  return { repoMap, denylist, prices, retention };
}

/** A service over the configured log roots (`%LOCALAPPDATA%\kyle-hub\<profile>\` unless the env overrides it). */
export function serviceFor(io: Io): FileLogService {
  const cfg = readLogConfig(io.env);
  return new FileLogService({
    repoMap: cfg.repoMap,
    denylist: cfg.denylist,
    prices: cfg.prices,
    retention: cfg.retention,
    projectsDir: defaultProjectsDir(io.env),
    dataRoot: (p: Profile) => dataDir(p, { env: io.env, homedir: os.homedir }),
  });
}

type Opts = Record<string, string | boolean | string[] | undefined> & { _: string[] };

const parseOpts = (rest: string[], options: Record<string, { type: "string" | "boolean" }>): Opts => {
  try {
    const r = parseArgs({ args: rest, options, strict: true, allowPositionals: true });
    return { ...(r.values as Record<string, string | boolean | undefined>), _: r.positionals };
  } catch (e) {
    throw new KtError(EXIT.usage, `${(e as Error).message}. Usage: ${USAGE}`);
  }
};

const fmtCost = (usd: number): string => `$${usd.toFixed(4)}`;

/** `kh logs <ingest|runs|show|sweep>`: incremental ingest, index queries and retention, all under %LOCALAPPDATA%\kyle-hub\<profile>\. */
export async function runLogs(argv: string[], io: Io): Promise<number> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case "ingest": {
      const v = parseOpts(rest, { profile: { type: "string" } });
      if (v.profile !== undefined && !isProfile(v.profile)) throw new KtError(EXIT.usage, `--profile must be home or work. Usage: ${USAGE}`);
      const res = await serviceFor(io).ingest(isProfile(v.profile) ? { profile: v.profile } : {});
      io.out(`runs updated: ${res.runsUpdated}, records: ${res.records}, skipped: ${res.skipped}`);
      return EXIT.ok;
    }
    case "runs": {
      const v = parseOpts(rest, { since: { type: "string" }, ticket: { type: "string" }, repo: { type: "string" }, json: { type: "boolean" }, limit: { type: "string" } });
      const limit = v.limit === undefined ? 50 : Number(v.limit);
      if (!Number.isInteger(limit) || limit < 1) throw new KtError(EXIT.usage, `--limit must be a positive integer. Usage: ${USAGE}`);
      if (v.since !== undefined && Number.isNaN(Date.parse(v.since as string))) throw new KtError(EXIT.usage, `--since must be a date or ISO time. Usage: ${USAGE}`);
      const runs = await serviceFor(io).runs({ since: v.since as string | undefined, ticketId: v.ticket as string | undefined, repo: v.repo as string | undefined, limit });
      if (v.json === true) io.out(JSON.stringify(runs, null, 2));
      else {
        io.out(["start", "runId", "ticket", "repo", "cost", "tools", "errs", "denials", "outcome"].join("\t"));
        for (const r of runs) io.out([r.start, r.runId, r.ticketId ?? "-", r.repo ?? "-", fmtCost(r.costUsd), r.toolCalls, r.errors, r.denials, r.outcome ?? "-"].join("\t"));
        io.out(`${runs.length} run(s)`);
      }
      return EXIT.ok;
    }
    case "show": {
      const v = parseOpts(rest, {});
      const runId = v._[0];
      if (runId === undefined) throw new KtError(EXIT.usage, `Usage: kh logs show <runId>`);
      const svc = serviceFor(io);
      const entry = await svc.run(runId);
      if (!entry) throw new KtError(EXIT.notFound, `No run "${runId}" in the index. Try kh logs runs.`);
      io.out(JSON.stringify(entry, null, 2));
      let n = 0;
      for await (const rec of svc.records(runId)) {
        if (n++ >= 200) {
          io.out(`... (more records not shown)`);
          break;
        }
        io.out(JSON.stringify(rec));
      }
      return EXIT.ok;
    }
    case "sweep": {
      const v = parseOpts(rest, { "dry-run": { type: "boolean" } });
      const dryRun = v["dry-run"] === true;
      const results = await serviceFor(io).sweep({ dryRun });
      let total = 0;
      for (const r of results) {
        for (const it of r.items) {
          total++;
          io.out(`${dryRun ? "would remove" : "removed"} ${it.kind}: ${it.path}${it.detail ? ` (${it.detail})` : ""}`);
        }
      }
      io.out(`${total} item(s) ${dryRun ? "matched (dry run, nothing deleted)" : "removed"}`);
      return EXIT.ok;
    }
    default:
      throw new KtError(EXIT.usage, `Usage: ${USAGE}`);
  }
}
