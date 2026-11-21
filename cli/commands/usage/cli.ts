import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { accountsOf } from "../../../src/core/accounts";
import { usageLine } from "../../../src/core/domain/usage";
import type { LogService } from "../../../src/core/logs/types";
import { usageSettingsOf, UsageTracker } from "../../../src/core/usage/service";
import { EXIT, KtError, type Io } from "../tickets/cli";
import { serviceFor } from "../logs/cli";

const USAGE = "kh usage [--account <id>] [--json]";
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** `modules.core` and `modules.usage` from the first vault's plugin data.json (read-only); empty when absent. */
function readConfig(env: Record<string, string | undefined>): { core: Obj; usage: Obj } {
  const vault = (env.KYLE_HUB_VAULTS ?? env.KYLE_TICKETS_VAULTS ?? "").split(";").map((s) => s.trim()).find((s) => s.length > 0);
  if (!vault) return { core: {}, usage: {} };
  try {
    const d: unknown = JSON.parse(fs.readFileSync(path.join(vault, ".obsidian", "plugins", "kyle-hub", "data.json"), "utf8"));
    const m = isObj(d) && isObj(d.modules) ? d.modules : {};
    return { core: isObj(m.core) ? m.core : {}, usage: isObj(m.usage) ? m.usage : {} };
  } catch {
    return { core: {}, usage: {} };
  }
}

/** `kh usage [--account id] [--json]`: session and week estimates per account from the derived logs. Run `kh logs ingest` first for fresh numbers. */
export async function runUsage(argv: string[], io: Io, logs?: Pick<LogService, "usageEvents">): Promise<number> {
  let v;
  try {
    v = parseArgs({ args: argv, options: { account: { type: "string" }, json: { type: "boolean" } }, strict: true, allowPositionals: false }).values;
  } catch (e) {
    throw new KtError(EXIT.usage, `${(e as Error).message}. Usage: ${USAGE}`);
  }
  const cfg = readConfig(io.env);
  const accounts = accountsOf(cfg.core).list;
  if (v.account !== undefined && !accounts.some((a) => a.id === v.account)) throw new KtError(EXIT.notFound, `No account "${v.account}". Try kh account list.`);
  const tracker = new UsageTracker({
    logs: () => logs ?? serviceFor(io),
    accounts: () => accounts.filter((a) => v.account === undefined || a.id === v.account),
    settings: () => usageSettingsOf(cfg.usage),
    now: () => io.now().getTime(),
    cacheMs: 0,
  });
  const snap = await tracker.snapshot();
  if (v.json === true) io.out(JSON.stringify(snap, null, 2));
  else if (snap.length === 0) io.out("No accounts configured (kh account add).");
  else for (const u of snap) io.out(usageLine(u, io.now().getTime()));
  return EXIT.ok;
}
