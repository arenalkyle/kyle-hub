import { runKh } from "../kh";
import { processIo } from "./io";

runKh(process.argv.slice(2), processIo()).then((code) => {
  process.exitCode = code;
});
