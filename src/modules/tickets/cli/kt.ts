import fs from "node:fs";
import { run } from "./cli";

process.exitCode = run(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  stdin: () => fs.readFileSync(0, "utf8"),
  out: (s) => process.stdout.write(s + "\n"),
  err: (s) => process.stderr.write(s + "\n"),
  now: () => new Date(),
});
