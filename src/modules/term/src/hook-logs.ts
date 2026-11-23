import type { BrainAccessEvent, ServiceRegistry } from "../../../core";
import { accessFromHook } from "../../../core/domain/access";
import type { HookMessage } from "./hook-server";

export interface HookLogOptions {
  /** Absolute vault root; access events outside it are dropped. Omitted = no access capture. */
  vaultRoot?: string;
  /** Publishes the live `brain:access` event. */
  emitAccess?: (e: BrainAccessEvent) => void;
  /** Publishes `subagent:started` / `subagent:ended`. */
  emitSubagent?: (e: { kind: "started" | "ended"; sessionId: string; agentId: string; agentType?: string }) => void;
  now?: () => Date;
}

const nonEmpty = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

/**
 * Forwards one hook event to the core LogService spool and, for vault reads/writes/searches, to the
 * `brain:access` bus event. Sub-agent events (payload `agent_id`) get the sub-agent id as `sessionId`
 * and the terminal session as `parentSessionId`. Absent logs service is a no-op; never throws.
 */
export function forwardHookToLogs(services: Pick<ServiceRegistry, "get">, m: HookMessage, opts: HookLogOptions = {}): void {
  try {
    const cwd = typeof m.payload.cwd === "string" ? m.payload.cwd : undefined;
    const agentId = nonEmpty(m.payload.agent_id);
    const agentType = nonEmpty(m.payload.agent_type);
    const link = agentId ? { sessionId: agentId, parentSessionId: m.session, ...(agentType ? { agentType } : {}) } : { sessionId: m.session };
    const t = (opts.now?.() ?? new Date()).toISOString();
    const access = opts.vaultRoot ? accessFromHook(m.event, m.payload, opts.vaultRoot) : null;
    services.get("logs")?.appendHookEvent({
      ...link, name: m.event, t, cwd, runId: m.env?.KH_RUN, ticketId: m.env?.KH_TICKET, accountId: m.env?.KH_ACCOUNT,
      ...(access ? { access: { ...access, vault: opts.vaultRoot } } : {}),
    });
    if (agentId && (m.event === "SubagentStart" || m.event === "SubagentStop")) {
      opts.emitSubagent?.({ kind: m.event === "SubagentStart" ? "started" : "ended", sessionId: m.session, agentId, ...(agentType ? { agentType } : {}) });
    }
    if (access && opts.emitAccess) {
      const { kind, path, pattern, hits } = access;
      opts.emitAccess({
        t, ...link, kind,
        ...(cwd !== undefined ? { cwd } : {}),
        ...(path !== undefined ? { path } : {}),
        ...(pattern !== undefined ? { pattern } : {}),
        ...(hits !== undefined ? { hits } : {}),
      });
    }
  } catch {
    // hooks must not fail Claude Code; a broken log write is dropped
  }
}
