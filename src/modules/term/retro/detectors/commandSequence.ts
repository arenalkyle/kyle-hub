import { signalOf, str, type PerRunDetector } from "./common";

const MIN_WINDOW = 3;
const MAX_WINDOW = 5;

/**
 * `seq:<cmd1>|<cmd2>|...` for every 3-5 window of consecutive non-trivial `tool_call.cmdNorm` values.
 * Each sequence counts once per run, so a loop does not inflate the count.
 */
export const commandSequence: PerRunDetector = (run, records, cfg) => {
  const ignore = new Set(cfg.ignoreCommands);
  const isTrivial = (cmd: string): boolean => cmd.split(";").every((seg) => ignore.has(seg.trim()));
  const cmds: { cmd: string; t: string }[] = [];
  for (const r of records) {
    const cmd = r.type === "tool_call" ? str(r.cmdNorm) : undefined;
    if (cmd !== undefined && !isTrivial(cmd)) cmds.push({ cmd, t: r.t });
  }
  const seen = new Map<string, string>();
  for (let len = MIN_WINDOW; len <= MAX_WINDOW; len++) {
    for (let i = 0; i + len <= cmds.length; i++) {
      const window = cmds.slice(i, i + len);
      const sig = `seq:${window.map((c) => c.cmd).join("|")}`;
      const start = window[0];
      if (start && !seen.has(sig)) seen.set(sig, start.t);
    }
  }
  return [...seen].map(([sig, t]) => signalOf(run, "command_sequence", sig, t));
};

