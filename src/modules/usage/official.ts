import { spawn } from "node:child_process";
import type { Account } from "../../core/accounts";
import type { OfficialReader, OfficialReading } from "../../core/usage/service";

const pctAfter = (text: string, label: RegExp): number | undefined => {
  const m = new RegExp(`${label.source}[^\\d\\n]{0,60}(\\d{1,3}(?:\\.\\d+)?)\\s*%`, "i").exec(text);
  return m ? Number(m[1]) : undefined;
};

/** Pulls the session and week percentages out of the CLI's `/usage` text. Undefined unless both are found. */
export function parseOfficialUsage(text: string): OfficialReading | undefined {
  const sessionPercent = pctAfter(text, /(?:current\s+)?session/);
  const weekPercent = pctAfter(text, /(?:current\s+)?week/);
  return sessionPercent === undefined || weekPercent === undefined ? undefined : { sessionPercent, weekPercent };
}

export type RunText = (command: string, args: string[], env: Record<string, string>, timeoutMs: number) => Promise<string>;

const runText: RunText = (command, args, env, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, shell: true, windowsHide: true });
    let out = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("timed out"));
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(out);
    });
  });

/**
 * Best-effort, undocumented: runs the account's own `claude -p "/usage"` with its CLAUDE_CONFIG_DIR and parses the text.
 * kyle-hub never reads credential files; the CLI uses its own login. Any failure rejects (the caller falls back to the estimate).
 */
export function cliOfficialReader(claudeCommand: string, run: RunText = runText): OfficialReader {
  return async (account: Account) => {
    const text = await run(claudeCommand, ["-p", '"/usage"'], { CLAUDE_CONFIG_DIR: account.configDir }, 20_000);
    return parseOfficialUsage(text);
  };
}
