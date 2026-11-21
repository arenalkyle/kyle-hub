import { run as runKh } from "./kh";
import type { Io } from "./commands/tickets/cli";

/** `kt <args>` is `kh tickets <args>`; kept so existing skills, AGENTS.md and habits work. */
export function run(argv: string[], io: Io): number {
  return runKh(["tickets", ...argv], io);
}
