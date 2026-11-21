import fs from "node:fs";
import type { Io } from "../commands/tickets/cli";

/** Process-bound IO for the bin entries. */
export function processIo(): Io {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdin: () => fs.readFileSync(0, "utf8"),
    out: (s) => process.stdout.write(s + "\n"),
    err: (s) => process.stderr.write(s + "\n"),
    now: () => new Date(),
  };
}
