import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataDir } from "../../../src/core/paths";
import { defaultSchtasks, runDoctorChecks, type SchtasksRunner } from "../../../src/core/ops/environment";
import { buildSchtasksArgs, buildTaskXml, formatCommand, TASK_NAME } from "../../../src/core/ops/schedule";
import { EXIT, KtError, discoverFolder, run as runTickets, type Io } from "../tickets/cli";
import { serviceFor } from "../logs/cli";
import { computeAndWriteGaps } from "../gaps/cli";
import { readHubData, runBrainCheck } from "../brain/cli";

export interface OpsDeps {
  /** Runs schtasks.exe; the default spawns the real binary. Tests inject a fake. */
  schtasks: SchtasksRunner;
  nodePath: string;
  khPath: string;
  userId: string;
  homedir: string;
  now: Date;
}

/** Process-bound deps for the bin; `khPath` is the running bin/kh.js (npm link keeps it stable). */
export function defaultOpsDeps(io: Io): OpsDeps {
  const user = io.env.USERNAME ?? os.userInfo().username;
  const domain = io.env.USERDOMAIN;
  return {
    schtasks: defaultSchtasks,
    nodePath: process.execPath,
    khPath: path.resolve(process.argv[1] ?? ""),
    userId: domain ? `${domain}\\${user}` : user,
    homedir: os.homedir(),
    now: io.now(),
  };
}

const localIso = (d: Date): string => {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
};

/** `kh maintain`: ingest (all profiles) -> retention sweep -> `kh tickets expire` when the tickets folder is configured. */
export async function runMaintain(io: Io): Promise<number> {
  const svc = serviceFor(io);
  const res = await svc.ingest({});
  io.out(`ingest: runs updated ${res.runsUpdated}, records ${res.records}, skipped ${res.skipped}`);
  const sweep = await svc.sweep({});
  io.out(`sweep: removed ${sweep.reduce((n, r) => n + r.items.length, 0)} item(s)`);
  try {
    for (const { report } of await computeAndWriteGaps(io)) io.out(`gaps: ${report.summary.notes} notes graded, ${report.summary.byGrade.F} F`);
  } catch (e) {
    io.out(`gaps skipped: ${(e as Error).message}`);
  }
  let folder: string | undefined;
  try {
    folder = discoverFolder(undefined, io);
  } catch (e) {
    io.out(`tickets expire skipped: ${(e as Error).message}`);
    return EXIT.ok;
  }
  const expire = runTickets(["expire", "--dir", folder], io);
  if (readHubData(io.env).autoFindings) {
    try {
      await runBrainCheck(["--tickets", "--dir", folder], io);
    } catch (e) {
      io.out(`brain findings skipped: ${(e as Error).message}`);
    }
  }
  return expire;
}

/** `kh schedule install|uninstall|status`. `install` prints the exact schtasks command and only registers with --yes. */
export function runSchedule(argv: string[], io: Io, deps: OpsDeps): number {
  const [sub, ...rest] = argv;
  const yes = rest.includes("--yes");
  const usage = "Usage: kh schedule <install [--yes] | uninstall | status>";
  const xmlFile = path.join(dataDir("schedule", { env: io.env, homedir: () => deps.homedir }), `${TASK_NAME}.xml`);
  switch (sub) {
    case "install": {
      const xml = buildTaskXml({ nodePath: deps.nodePath, khPath: deps.khPath, userId: deps.userId, startBoundary: localIso(deps.now) });
      fs.mkdirSync(path.dirname(xmlFile), { recursive: true });
      fs.writeFileSync(xmlFile, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]));
      const argv2 = buildSchtasksArgs("create", xmlFile);
      io.out(`Command: ${formatCommand(argv2)}`);
      if (!yes) {
        io.out(`Not registered. Review the command above, then run: kh schedule install --yes`);
        return EXIT.ok;
      }
      const r = deps.schtasks(argv2);
      if (r.status !== 0) throw new KtError(EXIT.remote, `schtasks failed (exit ${r.status}): ${r.stdout.trim().slice(0, 300)}`);
      io.out(`Registered ${TASK_NAME}: every 30 minutes and at logon.`);
      return EXIT.ok;
    }
    case "uninstall": {
      const argv2 = buildSchtasksArgs("delete");
      io.out(`Command: ${formatCommand(argv2)}`);
      const r = deps.schtasks(argv2);
      io.out(r.status === 0 ? `Removed ${TASK_NAME}.` : `${TASK_NAME} was not registered.`);
      return EXIT.ok;
    }
    case "status": {
      const r = deps.schtasks(buildSchtasksArgs("query"));
      if (r.status !== 0) {
        io.out(`${TASK_NAME}: not registered. Run kh schedule install.`);
        return EXIT.ok;
      }
      for (const line of r.stdout.split(/\r?\n/)) if (/^(Status|Next Run Time|Last Run Time|Last Result):/.test(line.trim())) io.out(line.trim());
      return EXIT.ok;
    }
    default:
      throw new KtError(EXIT.usage, usage);
  }
}

/** `kh doctor`: cleanupPeriodDays, hooks, scheduled task and log dirs. Warnings do not fail; any `fail` exits 3. */
export function runDoctor(io: Io, deps: OpsDeps): number {
  const checks = runDoctorChecks(io.env, deps.homedir, deps.schtasks);
  for (const c of checks) io.out(`[${c.status}] ${c.id}: ${c.message}`);
  return checks.some((c) => c.status === "fail") ? EXIT.validation : EXIT.ok;
}
