import path from "node:path";
import type { RetroService, RetroStatus, TicketService } from "../../../core/services";
import { dataDir } from "../../../core/paths";
import { type Profile, PROFILES } from "../../../core/logs/types";
import { effectiveType } from "../../../core/domain/fields";
import { makeRedactor } from "../../../core/redact";
import { applyProposal, canApply } from "./apply";
import { resolveRetroConfig } from "./config";
import { convertToProposal, draftRule, MAX_EXCERPTS, type LlmRunner } from "./llm";
import { performRetro } from "./run";
import { resolveRetroSettings, type RetroSettings } from "./settings";
import { readRetroState, retroFile, sessionsSinceRetro } from "./state";
import { readGapInputs } from "./gapReport";
import { countWaitingGapProposals } from "./detectors/gaps";
import type { TemplateContext } from "./templates";
import { parseSignature } from "./ticketMeta";
import type { LogReader } from "./types";

export interface RetroServiceDeps {
  tickets: () => TicketService | undefined;
  logs: () => LogReader | undefined;
  /** Raw `term.retro` settings. */
  rawSettings: () => unknown;
  /** Repo-map key -> `{ path, profile }`. */
  repos: () => Record<string, { path?: string; profile?: string } | undefined>;
  ctx: TemplateContext;
  /** Built only when `allowDraftRule` is on. */
  runner: () => LlmRunner;
  stateFile?: (profile: Profile) => string;
  /** Absolute vault root; its `.kyle-hub/gaps/latest.json` feeds the gap proposals. */
  vaultRoot?: () => string | undefined;
  /** The vault profile: retro reads and writes only this profile's logs (ADR-0008). Default `home`. */
  vaultProfile?: () => Profile;
  now?: () => Date;
}

const isProfile = (v: unknown): v is Profile => typeof v === "string" && (PROFILES as readonly string[]).includes(v);

const redactText = makeRedactor();

export function createRetroService(deps: RetroServiceDeps): RetroService {
  const listeners = new Set<() => void>();
  const notify = (): void => listeners.forEach((l) => l());
  const stateFile = deps.stateFile ?? ((p: Profile) => retroFile(dataDir(p)));
  const now = deps.now ?? (() => new Date());
  const vaultProfile = (): Profile => deps.vaultProfile?.() ?? "home";
  const settings = (): RetroSettings => resolveRetroSettings(deps.rawSettings());
  const need = <T>(v: T | undefined, what: string): T => {
    if (v === undefined) throw new Error(`${what} is not available (module off).`);
    return v;
  };
  const profileOf = (repo: string | undefined): Profile => {
    const p = repo !== undefined ? deps.repos()[repo]?.profile : undefined;
    return isProfile(p) ? p : "home";
  };

  return {
    async status(): Promise<RetroStatus> {
      const logs = need(deps.logs(), "Logs");
      let last: string | undefined;
      let lastEntry: RetroStatus["lastRetro"];
      let since = 0;
      for (const profile of [vaultProfile()]) {
        const s = readRetroState(stateFile(profile));
        if (s.lastRetroAt !== undefined && (last === undefined || s.lastRetroAt > last)) last = s.lastRetroAt;
        const latest = s.history.at(-1);
        if (latest !== undefined && (lastEntry === undefined || latest.at > lastEntry.at)) lastEntry = { at: latest.at, clusters: latest.clusters, ticketIds: latest.ticketIds };
        const runs = (await logs.runs({ since: s.watermark })).filter((r) => r.profile === profile);
        since += sessionsSinceRetro(runs, s.watermark);
      }
      const t = deps.tickets();
      const gapProposals = t === undefined ? 0 : countWaitingGapProposals(t.list(), t.statuses());
      return {
        ...(last !== undefined ? { lastRetroAt: last } : {}),
        ...(lastEntry !== undefined ? { lastRetro: lastEntry } : {}),
        sessionsSince: since,
        nudgeAt: settings().nudgeAt,
        gapProposals,
      };
    },

    async perform() {
      const r = await performRetro({
        logs: need(deps.logs(), "Logs"),
        tickets: need(deps.tickets(), "Tickets"),
        config: resolveRetroConfig(deps.rawSettings()),
        settings: settings(),
        ctx: deps.ctx,
        profiles: [vaultProfile()],
        stateFile: deps.stateFile,
        readGaps: () => {
          const root = deps.vaultRoot?.();
          return root === undefined ? undefined : readGapInputs(root);
        },
        now,
      });
      notify();
      return r;
    },

    canApply(id) {
      const t = deps.tickets();
      const issue = t?.get(id);
      return t !== undefined && issue !== undefined && canApply(issue, t.statuses());
    },

    async apply(id) {
      const tickets = need(deps.tickets(), "Tickets");
      const issue = tickets.get(id);
      const r = await applyProposal({ tickets, stateFile: stateFile(profileOf(issue?.repo)), now }, id);
      notify();
      return r.ok
        ? { ok: true, message: `Applied ${r.files.join(", ")}${r.backups.length > 0 ? ` (backup: ${path.basename(r.backups[0]!)})` : ""}.` }
        : { ok: false, message: r.error };
    },

    canDraft(id) {
      const issue = deps.tickets()?.get(id);
      if (!issue || !settings().allowDraftRule) return false;
      if (vaultProfile() === "work" || profileOf(issue.repo) === "work") return false; // work profile: no excerpts, no draft button
      return effectiveType(issue) === "finding" && (parseSignature(issue.description) ?? "").startsWith("corr:");
    },

    async draft(id) {
      const tickets = need(deps.tickets(), "Tickets");
      const issue = tickets.get(id);
      if (!issue) return { ok: false, message: `No ticket ${id}.` };
      if (vaultProfile() === "work" || profileOf(issue.repo) === "work") return { ok: false, message: "Draft rule is disabled for the work profile (no excerpts)." };
      const r = await draftRule(
        {
          settings,
          runner: deps.runner,
          stateFile: stateFile(profileOf(issue.repo)),
          ctx: deps.ctx,
          now,
          excerpts: async (runIds) => {
            const logs = deps.logs();
            const out: string[] = [];
            for (const runId of runIds) {
              if (!logs || out.length >= MAX_EXCERPTS) break;
              for await (const rec of logs.records(runId)) {
                const text = [rec.text, rec.excerpt, rec.message].find((v): v is string => typeof v === "string" && v.length > 0);
                if ((rec.type === "user_correction" || rec.type === "interrupt") && text) {
                  out.push(redactText(text));
                  break;
                }
              }
            }
            return out;
          },
        },
        { description: issue.description, repo: issue.repo },
      );
      return r.ok ? { ok: true, draft: { rule: r.rule, diff: r.diff, root: r.root, costUsd: r.costUsd } } : { ok: false, message: r.error };
    },

    async confirmDraft(id, draft) {
      await convertToProposal(need(deps.tickets(), "Tickets"), id, { ok: true, ...draft }, need(deps.tickets(), "Tickets").userName());
      notify();
    },

    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}


