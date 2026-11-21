import type { AttentionInfo, AttentionReason, AttentionService, HubEvents } from "../../../core";

type Emit = <K extends "session:needs-attention" | "session:attention-cleared">(event: K, payload: HubEvents[K]) => void;

/**
 * Which launched runs need a human right now. Transient view state rebuilt from live sessions;
 * never written to ticket files. One entry per session, newest reason wins.
 */
export class AttentionTracker {
  private readonly bySession = new Map<string, AttentionInfo>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly emit: Emit, private readonly now: () => number = Date.now) {}

  raise(sessionId: string, run: { ticketId: string; runId: string }, reason: AttentionReason): void {
    const cur = this.bySession.get(sessionId);
    if (cur?.reason === reason) return;
    this.bySession.set(sessionId, { sessionId, ticketId: run.ticketId, runId: run.runId, reason, since: this.now() });
    this.emit("session:needs-attention", { sessionId, ticketId: run.ticketId, runId: run.runId, reason });
    this.changed();
  }

  /** Clears the session's attention; `only` limits it to one reason. */
  clear(sessionId: string, only?: AttentionReason): void {
    const cur = this.bySession.get(sessionId);
    if (!cur || (only && cur.reason !== only)) return;
    this.bySession.delete(sessionId);
    this.emit("session:attention-cleared", { sessionId, ticketId: cur.ticketId, runId: cur.runId });
    this.changed();
  }

  clearTicket(ticketId: string): void {
    for (const a of [...this.bySession.values()]) if (a.ticketId === ticketId) this.clear(a.sessionId);
  }

  forTicket(ticketId: string): AttentionInfo | undefined {
    return [...this.bySession.values()].find((a) => a.ticketId === ticketId);
  }

  list(): AttentionInfo[] {
    return [...this.bySession.values()];
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** The service other modules read; `focus` reveals the session. */
  service(focus: (sessionId: string) => Promise<void>): AttentionService {
    return {
      get: (id) => this.forTicket(id),
      list: () => this.list(),
      focus: async (id) => {
        const a = this.forTicket(id);
        if (a) await focus(a.sessionId);
      },
      subscribe: (cb) => this.subscribe(cb),
    };
  }

  private changed(): void {
    for (const l of [...this.listeners]) l();
  }
}

/** A working session with no hook activity for `idleMs` is stalled. Pure over a clock. */
export class StallDetector {
  private readonly lastSeen = new Map<string, number>();

  constructor(private readonly now: () => number, private readonly idleMs: () => number) {}

  /** Record activity of a session in a working state. */
  touch(sessionId: string): void {
    this.lastSeen.set(sessionId, this.now());
  }

  stop(sessionId: string): void {
    this.lastSeen.delete(sessionId);
  }

  /** Session ids that have been silent too long (each reported again until touched or stopped). */
  stalled(): string[] {
    const limit = this.now() - this.idleMs();
    return [...this.lastSeen].filter(([, t]) => t <= limit).map(([id]) => id);
  }
}
