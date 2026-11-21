import { run } from "../kt";
import { processIo } from "./io";

process.exitCode = run(process.argv.slice(2), processIo());
