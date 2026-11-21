import path from "node:path";
import type { Signal } from "../types";
import { signalOf, str, type PerRunDetector } from "./common";

/**
 * `corr:<tool>:<cmdNorm or file ext>` for interrupts and corrections. The key is the last shell command,
 * else the extension of the last file touched by a Read/Edit/Write.
 */
export const userCorrection: PerRunDetector = (run, records) => {
  const out: Signal[] = [];
  let lastCmd: string | undefined;
  let lastExt: string | undefined;
  for (const r of records) {
    if (r.type === "tool_call") {
      lastCmd = str(r.cmdNorm);
    } else if (r.type === "file_read" || r.type === "file_write") {
      const rel = str(r.pathRel);
      lastExt = rel ? path.posix.extname(rel) || undefined : undefined;
    } else if (r.type === "user_correction" || r.type === "interrupt") {
      const tool = str(r.afterTool) ?? "-";
      out.push(signalOf(run, "user_correction", `corr:${tool}:${lastCmd ?? lastExt ?? "-"}`, r.t));
    }
  }
  return out;
};
