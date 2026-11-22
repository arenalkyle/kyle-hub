import { parseArgs } from "node:util";
import { writeGaps } from "../../../src/core/gaps/gather";
import type { GapsReport } from "../../../src/core/domain/gaps";
import { EXIT, KtError, type Io } from "../tickets/cli";
import { serviceFor } from "../logs/cli";
import { readHubData } from "../brain/cli";

const USAGE = "kh gaps [--json]";

/** Computes the gaps report for the first configured vault and writes `<vault>/.kyle-hub/gaps/latest.json`. */
export async function computeAndWriteGaps(io: Io): Promise<{ report: GapsReport; file: string }> {
  const vault = readHubData(io.env).vault;
  if (!vault) throw new KtError(EXIT.usage, "No vault configured (KYLE_HUB_VAULTS / KYLE_TICKETS_VAULTS).");
  return writeGaps({ vaultRoot: vault, logs: serviceFor(io), now: io.now() });
}

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

/** `kh gaps [--json]`: grade vault notes and list what the vault is missing. */
export async function runGaps(argv: string[], io: Io): Promise<number> {
  let json = false;
  try {
    json = parseArgs({ args: argv, options: { json: { type: "boolean" } }, strict: true, allowPositionals: false }).values.json === true;
  } catch (e) {
    throw new KtError(EXIT.usage, `${(e as Error).message}. Usage: ${USAGE}`);
  }
  const { report, file } = await computeAndWriteGaps(io);
  if (json) {
    io.out(JSON.stringify(report, null, 2));
    return EXIT.ok;
  }
  if (report.warning) io.err(`kh: warning: ${report.warning}`);
  const g = report.summary.byGrade;
  io.out(`${report.summary.notes} notes: A ${g.A}, B ${g.B}, C ${g.C}, D ${g.D}, F ${g.F}`);
  for (const n of report.grades.filter((x) => x.grade === "D" || x.grade === "F").slice(0, 10)) io.out(`  ${n.path}: ${n.reasons}`);
  for (const e of report.emptySearches.slice(0, 5)) io.out(`empty search: ${e.pattern ?? "(no pattern)"} in ${e.root} x${e.count} (${Math.round(e.totalMs / 1000)}s)`);
  for (const m of report.missingNotes.slice(0, 5)) io.out(`missing note: [[${m.target}]] (${m.reads} reads, ${m.emptySearches} empty searches)`);
  for (const f of report.largeFolders.slice(0, 5)) io.out(`large folder: ${f.folder} (${f.notes} notes, avg ${f.avgWords} words)`);
  io.out(`search time: ${pct(report.searchTime.share)} of agent time`);
  io.out(`wrote ${file}`);
  return EXIT.ok;
}
