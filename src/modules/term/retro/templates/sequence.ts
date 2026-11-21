import path from "node:path";
import { appendLine, evidence, fileDiff, targetRoot, truncate } from "./diffs";
import type { Template } from "./types";

export const MAX_SCRIPT_LINES = 40;

const hash4 = (s: string): string => {
  let h = 5381;
  for (const c of s) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return h.toString(16).padStart(8, "0").slice(0, 4);
};

export function commandsOf(signature: string): string[] {
  return signature.slice("seq:".length).split("|").filter((c) => c.length > 0);
}

const firstWord = (cmd: string): string => /^[^\s;]+/.exec(cmd.trim())?.[0] ?? "cmd";

export function slugOf(signature: string): string {
  const base = commandsOf(signature)
    .map((c) => firstWord(c).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
    .filter(Boolean)
    .join("-");
  return `${base.slice(0, 40).replace(/-$/, "") || "seq"}-${hash4(signature)}`;
}

export const summaryOf = (signature: string): string => commandsOf(signature).map(firstWord).join(" then ");

/** PowerShell script running the commands in order; masked tokens (`<path>`, `<num>`) become `$args[n]`. Always <= 40 lines. */
export function scriptText(signature: string, count: number): string {
  let n = 0;
  const lines = [`# kyle-hub retro: ${summaryOf(signature)} (seen ${count}x). Pass the variable parts as arguments.`, "$ErrorActionPreference = 'Stop'", ""];
  for (const cmd of commandsOf(signature)) {
    lines.push(cmd.replace(/<[a-z]+>/g, () => `$args[${n++}]`), "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }");
  }
  return `${lines.slice(0, MAX_SCRIPT_LINES).join("\n")}\n`;
}

export const commandSequenceTemplate: Template = (cluster, ctx) => {
  const slug = slugOf(cluster.signature);
  const { root } = targetRoot(cluster, ctx);
  const scriptRel = `scripts/${slug}.ps1`;
  const rule = `Use \`${scriptRel}\` for ${summaryOf(cluster.signature)}.`;
  const before = ctx.readFile(path.join(root, "CLAUDE.md"));
  const diff = fileDiff(scriptRel, undefined, scriptText(cluster.signature, cluster.count)) + fileDiff("CLAUDE.md", before, appendLine(before, rule));
  return {
    type: "proposal",
    title: truncate(`Script for repeated sequence: ${summaryOf(cluster.signature)}`, 100),
    body: `The same ${commandsOf(cluster.signature).length} commands ran in order ${cluster.count}x across ${cluster.sessions.length} sessions. Add \`${scriptRel}\` and point \`CLAUDE.md\` at it.\n\nTarget: ${root}\n\n${evidence(cluster)}`,
    diff,
  };
};
