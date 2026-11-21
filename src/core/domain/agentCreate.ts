import type { Issue, StatusDef } from "./types";
import type { TicketType } from "./fields";
import { fingerprintOf } from "./fingerprint";
import { checkCaps, findDuplicate, type FloodSettings } from "./flood";
import { agentNewStatus, checkAgentLabels, type Refusal } from "./gates";

export interface AgentCreateInput {
  title: string;
  type?: TicketType;
  repo?: string;
  tags?: string[];
}

export interface AgentCreateContext {
  statuses: readonly StatusDef[];
  issues: readonly Issue[];
  /** `agent:<run or session>`; also the per-run cap key. */
  source: string;
  flood: FloodSettings;
}

export type AgentCreatePlan =
  | { ok: true; status: string; source: string; fingerprint: string; duplicate?: Issue }
  | Refusal;

/**
 * Gate for agent-created tickets: forces triage status, refuses `agent-ready`,
 * returns the existing open ticket when fingerprints match (caller adds the
 * "seen again" comment), and enforces the per-run and open-triage caps.
 */
export function planAgentCreate(input: AgentCreateInput, ctx: AgentCreateContext): AgentCreatePlan {
  const forced = agentNewStatus(ctx.statuses);
  if (!forced.ok) return forced;
  const labels = checkAgentLabels(input.tags ?? []);
  if (!labels.ok) return labels;
  const fingerprint = fingerprintOf({ type: input.type ?? "task", repo: input.repo, title: input.title });
  const base = { ok: true as const, status: forced.status, source: ctx.source, fingerprint };
  const dup = findDuplicate(ctx.issues, ctx.statuses, fingerprint);
  if (dup) return { ...base, duplicate: dup };
  const caps = checkCaps(ctx.issues, ctx.statuses, ctx.source, ctx.flood);
  if (!caps.ok) return caps;
  return base;
}
