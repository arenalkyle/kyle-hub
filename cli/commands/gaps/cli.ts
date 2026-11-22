import { parseArgs } from "node:util";
import { writeGaps } from "../../../src/core/gaps/gather";
import type { GapsReport } from "../../../src/core/domain/gaps";
import { resolveRepo } from "../../../src/core/logs/service";
import { EXIT, KtError, type Io } from "../tickets/cli";
import { readLogConfig, serviceFor } from "../logs/cli";

const USAGE = "kh gaps [--vault <path>] [--json]";

export interface VaultGaps {
  vault: string;
  report: GapsReport;
  file: string;
}

/** Computes and writes `<vault>/.kyle-hub/gaps/latest.json` for each configured vault (or just `only`), each with its own grading.json and profile. */
export async function computeAndWriteGaps(io: Io, only?: string): Promise<VaultGaps[]> {
  const cfg = readLogConfig(io.env);
  const vaults = only !== undefined ? [only] : cfg.vaults;
  if (vaults.length === 0) throw new KtError(EXIT.usage, "No vault configured (KYLE_HUB_VAULTS / KYLE_TICKETS_VAULTS).");
  const logs = serviceFor(io);
  const out: VaultGaps[] = [];
  for (const vault of vaults) {
    const profile = resolveRepo(vault, cfg.repoMap).profile;
    out.push({ vault, ...(await writeGaps({ vaultRoot: vault, logs, now: io.now(), profile, allVaults: cfg.vaults })) });
  }
  return out;
}

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

/** `kh gaps [--vault <path>] [--json]`: grade each configured vault's notes and list what it is missing. */
export async function runGaps(argv: string[], io: Io): Promise<number> {
  let json = false;
  let only: string | undefined;
  try {
    const v = parseArgs({ args: argv, options: { json: { type: "boolean" }, vault: { type: "string" } }, strict: true, allowPositionals: false }).values;
    json = v.json === true;
    only = v.vault;
  } catch (e) {
    throw new KtError(EXIT.usage, `${(e as Error).message}. Usage: ${USAGE}`);
  }
  const results = await computeAndWriteGaps(io, only);
  if (json) {
    io.out(JSON.stringify(results.length === 1 ? results[0]!.report : results.map((r) => ({ vault: r.vault, ...r.report })), null, 2));
    return EXIT.ok;
  }
  for (const { vault, report, file } of results) {
    if (results.length > 1) io.out(`== ${vault}`);
    if (report.warning) io.err(`kh: warning: ${report.warning}`);
    const g = report.summary.byGrade;
    io.out(`${report.summary.notes} notes: A ${g.A}, B ${g.B}, C ${g.C}, D ${g.D}, F ${g.F}`);
    for (const n of report.grades.filter((x) => x.grade === "D" || x.grade === "F").slice(0, 10)) io.out(`  ${n.path}: ${n.reasons}`);
    for (const e of report.emptySearches.slice(0, 5)) io.out(`empty search: ${e.pattern ?? "(no pattern)"} in ${e.root} x${e.count} (${Math.round(e.totalMs / 1000)}s)`);
    for (const m of report.missingNotes.slice(0, 5)) io.out(`missing note: [[${m.target}]] (${m.reads} reads, ${m.emptySearches} empty searches)`);
    for (const f of report.largeFolders.slice(0, 5)) io.out(`large folder: ${f.folder} (${f.notes} notes, avg ${f.avgWords} words)`);
    io.out(`search and read time: ${pct(report.searchTime.share)} of agent time`);
    io.out(`wrote ${file}`);
  }
  return EXIT.ok;
}
