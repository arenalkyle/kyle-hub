import { signalOf, str, type PerRunDetector } from "./common";

/** `doc:<repo>:<pathRel>` for files read within the first `startupCalls` tool calls; once per run per file. */
export const startupDocs: PerRunDetector = (run, records, cfg) => {
  const seen = new Map<string, string>();
  let calls = 0;
  for (const r of records) {
    if (r.type === "tool_call") calls++;
    else if (r.type === "file_read" && calls < cfg.startupCalls) {
      const rel = str(r.pathRel);
      if (rel && !seen.has(rel)) seen.set(rel, r.t);
    }
  }
  return [...seen].map(([rel, t]) => signalOf(run, "startup_docs", `doc:${run.repo ?? "-"}:${rel}`, t));
};
