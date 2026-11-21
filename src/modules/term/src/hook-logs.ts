import type { ServiceRegistry } from "../../../core";
import type { HookMessage } from "./hook-server";

/** Forwards one hook event to the core LogService spool. Absent logs service (module off) is a no-op; never throws. */
export function forwardHookToLogs(services: Pick<ServiceRegistry, "get">, m: HookMessage): void {
  try {
    const logs = services.get("logs");
    if (!logs) return;
    const cwd = typeof m.payload.cwd === "string" ? m.payload.cwd : undefined;
    logs.appendHookEvent({ sessionId: m.session, name: m.event, cwd, runId: m.env?.KH_RUN, ticketId: m.env?.KH_TICKET });
  } catch {
    // hooks must not fail Claude Code; a broken log write is dropped
  }
}
