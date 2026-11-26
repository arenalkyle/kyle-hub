import { runImport } from "./commands/import/linear";
import { runLogs } from "./commands/logs/cli";
import { runGaps } from "./commands/gaps/cli";
import { runTemplates } from "./commands/templates/cli";
import { runBrain } from "./commands/brain/cli";
import { runStatusDraft } from "./commands/brain/status";
import { runAccount } from "./commands/account/cli";
import { runPromote } from "./commands/promote/cli";
import { runUsage } from "./commands/usage/cli";
import { runRetro } from "./commands/retro/cli";
import { defaultOpsDeps, runDoctor, runMaintain, runSchedule } from "./commands/ops/cli";
import { EXIT, KtError, run as runTickets, type Io } from "./commands/tickets/cli";
import type { LinearTransport } from "./commands/import/linear";

const MAIN = [
  "kh <command>",
  "  tickets <new|set|comment|list|show|pr|relate|unrelate|expire> [...]   same as kt (see kt --help)",
  "  import linear --team <key> [--project <name>] [--dry-run] [--update]",
  "  logs <ingest|runs|show|sweep> [...]   transcript ingest, run index, retention (kh logs --help)",
  "  retro detect [--profile home|work] [--json]   dry-run retro clusters (writes nothing)",
  "  lint docs [--repo <key>|--vault] [--json]     validate doc frontmatter and sections; exit 1 on errors",
  "  brain check [--repo <key>] [--json] [--tickets]   lint + staleness per repo; --tickets files findings",
  "  status draft --repo <key> [--dir <tickets folder>]   STATUS.md skeleton to stdout (writes nothing)",
  "  promote <file> --to <homeVault> [--brain-folder <dir>] [--dry-run]   scrub a work lesson into <homeVault>/<brain folder>/lessons (default: the home vault's setting, else Brain; --dry-run writes nothing)",
  "  account <list|add|login|use|remove> [...]   Claude accounts, one CLAUDE_CONFIG_DIR each (kh account --help)",
  "  gaps [--json]                      grade vault notes, empty searches, missing notes (writes .kyle-hub/gaps/latest.json)",
  "  templates <list|show <id>> [--vault <path>]   editable templates: vault override or shipped default (list marks overrides)",
  "  usage [--account <id>] [--json]    session (5 h) and week usage per account (estimates; run kh logs ingest first)",
  "  maintain                           ingest -> sweep -> tickets expire (run by the scheduled task)",
  "  schedule <install|uninstall|status> [--yes]   Task Scheduler task kyle-hub-maintain (no admin)",
  "  doctor                              cleanupPeriodDays, hooks, scheduled task, log dirs",
].join("\n");

/** Synchronous dispatch for the ticket commands (the kt shim and tests use this). */
export function run(argv: string[], io: Io): number {
  const [cmd, ...rest] = argv;
  if (cmd === "tickets") return runTickets(rest, io);
  if (cmd === undefined || cmd === "--help" || cmd === "-h" || cmd === "help") {
    io.out(MAIN);
    return EXIT.ok;
  }
  io.err(`kh: unknown command "${cmd}". Run kh --help.`);
  return EXIT.usage;
}

/** Full dispatch, including the async `import linear` (Linear HTTP). */
export async function runKh(argv: string[], io: Io, transport?: LinearTransport): Promise<number> {
  const [cmd, sub, ...rest] = argv;
  if (cmd === "logs") {
    try {
      return await runLogs(argv.slice(1), io);
    } catch (e) {
      io.err(`kh: ${(e as Error).message}`);
      return e instanceof KtError ? e.code : EXIT.remote;
    }
  }
  if (cmd === "gaps") {
    try {
      return await runGaps(argv.slice(1), io);
    } catch (e) {
      io.err(`kh: ${(e as Error).message}`);
      return e instanceof KtError ? e.code : EXIT.remote;
    }
  }
  if (cmd === "templates") {
    try {
      return runTemplates(argv.slice(1), io);
    } catch (e) {
      io.err(`kh: ${(e as Error).message}`);
      return e instanceof KtError ? e.code : EXIT.remote;
    }
  }
  if (cmd === "lint" || cmd === "brain") {
    try {
      return await runBrain(cmd, argv.slice(1), io);
    } catch (e) {
      io.err(`kh: ${(e as Error).message}`);
      return e instanceof KtError ? e.code : EXIT.remote;
    }
  }
  if (cmd === "status") {
    try {
      if (sub !== "draft") throw new KtError(EXIT.usage, "Usage: kh status draft --repo <key> [--dir <tickets folder>]");
      return runStatusDraft(rest, io);
    } catch (e) {
      io.err(`kh: ${(e as Error).message}`);
      return e instanceof KtError ? e.code : EXIT.remote;
    }
  }
  if (cmd === "promote") {
    try {
      return runPromote(argv.slice(1), io);
    } catch (e) {
      io.err(`kh: ${(e as Error).message}`);
      return e instanceof KtError ? e.code : EXIT.remote;
    }
  }
  if (cmd === "account") {
    try {
      return runAccount(argv.slice(1), io);
    } catch (e) {
      io.err(`kh: ${(e as Error).message}`);
      return e instanceof KtError ? e.code : EXIT.remote;
    }
  }
  if (cmd === "usage") {
    try {
      return await runUsage(argv.slice(1), io);
    } catch (e) {
      io.err(`kh: ${(e as Error).message}`);
      return e instanceof KtError ? e.code : EXIT.remote;
    }
  }
  if (cmd === "retro") {
    try {
      return await runRetro(argv.slice(1), io);
    } catch (e) {
      io.err(`kh: ${(e as Error).message}`);
      return e instanceof KtError ? e.code : EXIT.remote;
    }
  }
  if (cmd === "maintain" || cmd === "schedule" || cmd === "doctor") {
    try {
      const deps = defaultOpsDeps(io);
      if (cmd === "maintain") return await runMaintain(io);
      if (cmd === "doctor") return runDoctor(io, deps);
      return runSchedule(argv.slice(1), io, deps);
    } catch (e) {
      io.err(`kh: ${(e as Error).message}`);
      return e instanceof KtError ? e.code : EXIT.remote;
    }
  }
  if (cmd !== "import") return run(argv, io);
  try {
    if (sub !== "linear") throw new KtError(EXIT.usage, `Unknown import source "${sub ?? ""}". Supported: linear.`);
    return await runImport(rest, io, transport);
  } catch (e) {
    if (e instanceof KtError) {
      io.err(`kh: ${e.message}`);
      return e.code;
    }
    io.err(`kh: ${(e as Error).message}`);
    return EXIT.remote;
  }
}
