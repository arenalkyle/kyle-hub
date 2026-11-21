import type { StatusDef } from "./types";
import { categoryOf } from "./fields";

export const AGENT_READY = "agent-ready";
/** Exit code for an agent-mode refusal (caps use 3). */
export const GATE_EXIT = 1;

export interface Refusal {
  ok: false;
  exitCode: number;
  message: string;
}
export type GateResult = { ok: true } | Refusal;

const refuse = (message: string, exitCode = GATE_EXIT): Refusal => ({ ok: false, exitCode, message });

/** Agent mode: `--agent`, `KH_AGENT=1`, or implied by `KH_RUN`. */
export function isAgentMode(env: Record<string, string | undefined>, flag = false): boolean {
  return flag || env.KH_AGENT === "1" || (env.KH_RUN ?? "") !== "";
}

/** `agent:<KH_RUN>` when launched from a run, else `agent:<session>`. */
export function agentSource(env: Record<string, string | undefined>, session = "session"): `agent:${string}` {
  return `agent:${env.KH_RUN || session}`;
}

/** Status an agent-created ticket is forced into: first triage-category status by order. */
export function agentNewStatus(statuses: readonly StatusDef[]): { ok: true; status: string } | Refusal {
  const triage = [...statuses].filter((s) => s.category === "triage").sort((a, b) => a.order - b.order)[0];
  return triage ? { ok: true, status: triage.name } : refuse("No triage-category status exists; agents cannot create tickets.");
}

/** Agents may not add the human gate label. */
export function checkAgentLabels(labels: readonly string[]): GateResult {
  return labels.some((l) => l.trim().toLowerCase() === AGENT_READY)
    ? refuse(`Agents may not add the "${AGENT_READY}" label (human gate, ADR-0005).`)
    : { ok: true };
}

/** Agents may not move a ticket into a completed-category status (Done is human-only). */
export function checkAgentStatus(status: string, statuses: readonly StatusDef[]): GateResult {
  return categoryOf(status, statuses) === "completed"
    ? refuse(`Agents may not set a completed status ("${status}"); Done is human-only (ADR-0005).`)
    : { ok: true };
}
