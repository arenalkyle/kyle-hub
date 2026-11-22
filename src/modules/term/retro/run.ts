import type { TicketService } from "../../../core/services";
import { effectiveType } from "../../../core/domain/fields";
import { dataDir } from "../../../core/paths";
import type { Profile } from "../../../core/logs/types";
import type { GapsReport } from "../../../core/domain/gaps";
import type { GradingConfig } from "../../../core/domain/grading";
import { detect, gatherInput } from "./detect";
import { detectGapProposals, gapMemory } from "./detectors/gaps";
import { checkRecurrence } from "./recurrence";
import { commitRetro, readRetroState, retroFile, updateRetroState } from "./state";
import type { RetroSettings } from "./settings";
import { renderTemplate, type TemplateContext } from "./templates";
import { withDiff } from "./ticketMeta";
import type { LogReader, RetroConfig } from "./types";

export const RETRO_AUTHOR = "retro";

export interface RetroDeps {
  logs: LogReader;
  tickets: TicketService;
  config: RetroConfig;
  settings: RetroSettings;
  ctx: TemplateContext;
  profiles: readonly Profile[];
  /** Directory holding `<profile>/retro.json`'s parent: `dataDir(profile)` by default. */
  stateFile?: (profile: Profile) => string;
  /** The vault's gaps report and grading config; undefined = no gap proposals. */
  readGaps?: () => { report: GapsReport; grading: GradingConfig } | undefined;
  now?: () => Date;
}

export interface RetroResult {
  created: { id: string; title: string; type: string }[];
  /** Clusters whose ticket already existed (a "seen again" comment was added). */
  seenAgain: string[];
  /** Why a cluster got no ticket (refused by the gates, or over the cap). */
  skipped: string[];
  recurred: string[];
  resolved: string[];
  clusters: number;
}

/**
 * One retro over the given profiles: detect (with the ticketId -> type map for outliers), recurrence check on applied
 * proposals, tickets for the top clusters via the agent gates (`agent:retro`, so repeats dedupe), then commit the watermark.
 * Never touches the network or an LLM.
 */
export async function performRetro(deps: RetroDeps): Promise<RetroResult> {
  const { tickets, settings } = deps;
  const stateFile = deps.stateFile ?? ((p: Profile) => retroFile(dataDir(p)));
  const now = deps.now ?? (() => new Date());
  const result: RetroResult = { created: [], seenAgain: [], skipped: [], recurred: [], resolved: [], clusters: 0 };
  const ticketTypes = new Map(tickets.list().map((t) => [t.id, effectiveType(t)] as const));
  const actor = { agent: true, author: RETRO_AUTHOR } as const;
  let budget = settings.maxTickets;

  for (const profile of deps.profiles) {
    const file = stateFile(profile);
    const state = readRetroState(file);
    const input = await gatherInput(deps.logs, { config: deps.config, watermark: state.watermark, profile, ticketTypes });
    const detected = detect(input);
    result.clusters += detected.clusters.length;

    const { verdicts, entries } = checkRecurrence(state.applied, detected.signals, deps.config.minOccurrences);
    const ids: string[] = [];
    for (const v of verdicts) {
      if (v.kind === "recurred") {
        await tickets.comment(v.entry.ticketId, `Recurred ${v.count}× since apply`, { author: RETRO_AUTHOR });
        const f = await tickets.create(
          {
            title: `Proposal ${v.entry.ticketId} did not resolve ${v.entry.signature}`,
            type: "finding",
            description: `The pattern \`${v.entry.signature}\` occurred ${v.count}x after ${v.entry.ticketId} was applied (${v.entry.appliedAt}).\n\nSignature: \`${v.entry.signature}\``,
          },
          actor,
        ).catch((e: unknown) => {
          result.skipped.push(`${v.entry.ticketId}: ${(e as Error).message}`);
          return undefined;
        });
        result.recurred.push(v.entry.ticketId);
        if (f) ids.push(f.id);
      } else if (v.kind === "resolved") {
        await tickets.comment(v.entry.ticketId, "Resolved", { author: RETRO_AUTHOR });
        result.resolved.push(v.entry.ticketId);
      }
    }
    if (entries.length > 0) updateRetroState(file, (s) => ({ ...s, applied: entries }));

    for (const c of detected.clusters) {
      const t = renderTemplate(c, deps.ctx);
      const known = new Set(tickets.list().map((i) => i.id));
      if (budget <= 0 && !tickets.list().some((i) => i.title === t.title)) {
        result.skipped.push(`${c.signature}: over the ${settings.maxTickets}-ticket cap`);
        continue;
      }
      try {
        const issue = await tickets.create(
          { title: t.title, type: t.type, ...(c.repo !== undefined ? { repo: c.repo } : {}), description: withDiff(t.body, t.diff) },
          actor,
        );
        if (known.has(issue.id)) {
          result.seenAgain.push(issue.id);
        } else {
          budget--;
          result.created.push({ id: issue.id, title: issue.title, type: t.type });
        }
        ids.push(issue.id);
      } catch (e) {
        result.skipped.push(`${c.signature}: ${(e as Error).message}`);
      }
    }
    commitRetro(file, detected, ids, now());
  }

  if (deps.readGaps) {
    const inputs = deps.readGaps();
    const picks = detectGapProposals(inputs?.report, gapMemory(tickets.list(), tickets.statuses()), inputs?.grading);
    for (const p of picks) {
      try {
        const issue = await tickets.create({ title: p.title, type: "finding", description: p.body }, actor);
        result.created.push({ id: issue.id, title: issue.title, type: "finding" });
      } catch (e) {
        result.skipped.push(`${p.signature}: ${(e as Error).message}`);
      }
    }
  }
  return result;
}
