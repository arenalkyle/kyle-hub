import { runImport } from "./commands/import/linear";
import { EXIT, KtError, run as runTickets, type Io } from "./commands/tickets/cli";
import type { LinearTransport } from "./commands/import/linear";

const MAIN = [
  "kh <command>",
  "  tickets <new|set|comment|list|show|pr|relate|unrelate|expire> [...]   same as kt (see kt --help)",
  "  import linear --team <key> [--project <name>] [--dry-run] [--update]",
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
