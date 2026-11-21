import { spawn } from "node:child_process";
import path from "node:path";
import { makeRedactor } from "../../../core/redact";
import type { TicketService } from "../../../core/services";
import { effectiveType } from "../../../core/domain/fields";
import { appendLine, fileDiff, type TemplateContext } from "./templates";
import { readRetroState, updateRetroState } from "./state";
import type { RetroSettings } from "./settings";
import { parseRunIds, parseSignature, parseTarget, withDiff } from "./ticketMeta";

/** Wraps `claude -p`; only ever constructed when `allowDraftRule` is on. Tests inject a spy. */
export interface LlmRunner {
  run(prompt: string): Promise<{ text: string; costUsd: number }>;
}

const redactText = makeRedactor();

export const MAX_PROMPT_CHARS = 8000; // about 2k tokens
export const MAX_EXCERPTS = 3;
export const MAX_RULE_CHARS = 240;

/** Real runner: `claude -p --model haiku --output-format json`, prompt on stdin. */
export function claudeRunner(command = "claude"): LlmRunner {
  return {
    run: (prompt) =>
      new Promise((resolve, reject) => {
        const child = spawn(command, ["-p", "--model", "haiku", "--output-format", "json"], { windowsHide: true, shell: process.platform === "win32" });
        let out = "";
        let err = "";
        child.stdout.on("data", (d: Buffer) => (out += d.toString()));
        child.stderr.on("data", (d: Buffer) => (err += d.toString()));
        child.on("error", reject);
        child.on("close", (code) => {
          if (code !== 0) return reject(new Error(err.trim() || `claude exited with ${code}`));
          try {
            const j = JSON.parse(out) as { result?: unknown; total_cost_usd?: unknown };
            resolve({ text: typeof j.result === "string" ? j.result : "", costUsd: typeof j.total_cost_usd === "number" ? j.total_cost_usd : 0 });
          } catch {
            resolve({ text: out.trim(), costUsd: 0 });
          }
        });
        child.stdin.end(prompt);
      }),
  };
}

export function buildPrompt(signature: string, count: number, sessions: number, excerpts: readonly string[]): string {
  const ex = excerpts.slice(0, MAX_EXCERPTS).map((e, i) => `Excerpt ${i + 1}: ${redactText(e).slice(0, 600)}`);
  const text = [
    "A coding agent was corrected by its user in the same situation repeatedly.",
    `Pattern: ${signature}`,
    `Occurrences: ${count} across ${sessions} sessions.`,
    ...ex,
    "Write ONE short rule (a single line, imperative, under 200 characters) for CLAUDE.md that prevents this. Reply with the rule only.",
  ].join("\n");
  return text.slice(0, MAX_PROMPT_CHARS);
}

const localDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const spentToday = (stateFile: string, now: Date): number => {
  const s = readRetroState(stateFile).llmSpend;
  return s && s.day === localDay(now) ? s.usd : 0;
};

export type DraftResult = { ok: true; rule: string; diff: string; root: string; costUsd: number } | { ok: false; error: string };

export interface DraftDeps {
  settings: () => RetroSettings;
  /** Called only after the settings check; builds the runner lazily. */
  runner: () => LlmRunner;
  stateFile: string;
  ctx: TemplateContext;
  /** Redacted record excerpts for the ticket's runs. */
  excerpts: (runIds: string[]) => Promise<string[]>;
  now?: () => Date;
}

/** One line, no bullet, no fences, bounded. */
export const cleanRule = (text: string): string =>
  (text.split(/\r?\n/).map((l) => l.replace(/^[-*>\s`]+|`+$/g, "").trim()).find((l) => l.length > 0) ?? "").slice(0, MAX_RULE_CHARS);

/** Drafts a CLAUDE.md rule for a user_correction finding. Refused when the setting is off or today's cap is spent. */
export async function draftRule(deps: DraftDeps, ticket: { description: string; repo?: string }): Promise<DraftResult> {
  const settings = deps.settings();
  if (!settings.allowDraftRule) return { ok: false, error: "Drafting rules with Haiku is off (term.retro.allowDraftRule)." };
  const now = (deps.now ?? (() => new Date()))();
  const spent = spentToday(deps.stateFile, now);
  if (spent >= settings.dailyCapUsd) return { ok: false, error: `Daily Haiku cap reached ($${spent.toFixed(2)} of $${settings.dailyCapUsd.toFixed(2)}).` };
  const signature = parseSignature(ticket.description);
  if (signature === undefined) return { ok: false, error: "The ticket has no signature." };
  const runIds = parseRunIds(ticket.description);
  const count = Number(/Seen (\d+)x across (\d+) sessions/.exec(ticket.description)?.[1] ?? 0);
  const sessions = Number(/Seen \d+x across (\d+) sessions/.exec(ticket.description)?.[1] ?? 0);
  const excerpts = await deps.excerpts(runIds);
  let res: { text: string; costUsd: number };
  try {
    res = await deps.runner().run(buildPrompt(signature, count, sessions, excerpts));
  } catch (e) {
    return { ok: false, error: `claude failed: ${(e as Error).message}` };
  }
  updateRetroState(deps.stateFile, (s) => ({
    ...s,
    llmSpend: { day: localDay(now), usd: (s.llmSpend && s.llmSpend.day === localDay(now) ? s.llmSpend.usd : 0) + res.costUsd },
  }));
  const rule = cleanRule(res.text);
  if (rule === "") return { ok: false, error: "Haiku returned no rule." };
  const repoDir = deps.ctx.repoPath(ticket.repo);
  const root = repoDir ?? deps.ctx.claudeHome;
  const before = deps.ctx.readFile(path.join(root, "CLAUDE.md"));
  return { ok: true, rule, root, costUsd: res.costUsd, diff: fileDiff("CLAUDE.md", before, appendLine(before, rule)) };
}

/** Converts the finding into a proposal carrying the drafted diff. */
export async function convertToProposal(tickets: TicketService, id: string, draft: Extract<DraftResult, { ok: true }>, author: string): Promise<void> {
  const issue = tickets.get(id);
  if (!issue || effectiveType(issue) !== "finding") throw new Error(`${id} is not a finding.`);
  const base = parseTarget(issue.description) === undefined ? `${issue.description}\n\nTarget: ${draft.root}` : issue.description;
  await tickets.update(id, { type: "proposal", description: withDiff(base, draft.diff) }, { author });
  await tickets.comment(id, `Drafted rule with Haiku: ${draft.rule}`, { author });
}
