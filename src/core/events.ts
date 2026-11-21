/** Typed event map; payloads are filled in as the emitting modules land. */
export interface HubEvents {
  "ticket:created": { id: string };
  "ticket:status-changed": { id: string; from: string; to: string };
  "ticket:label-changed": { id: string; added: string[]; removed: string[] };
  "session:started": { sessionId: string };
  "session:ended": { sessionId: string };
  "session:needs-attention": { sessionId: string };
  "run:ingested": { runId: string };
  "retro:completed": { retroId: string };
  "brain:health-changed": { healthy: boolean };
}

type Handler<K extends keyof HubEvents> = (payload: HubEvents[K]) => void;

export class EventBus {
  private handlers = new Map<keyof HubEvents, Set<Handler<never>>>();

  on<K extends keyof HubEvents>(event: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(handler as Handler<never>);
    return () => this.off(event, handler);
  }

  off<K extends keyof HubEvents>(event: K, handler: Handler<K>): void {
    this.handlers.get(event)?.delete(handler as Handler<never>);
  }

  /** A throwing handler never blocks the others. */
  emit<K extends keyof HubEvents>(event: K, payload: HubEvents[K]): void {
    for (const h of [...(this.handlers.get(event) ?? [])]) {
      try {
        (h as Handler<K>)(payload);
      } catch (e) {
        console.error(`kyle-hub: handler for ${event} threw`, e);
      }
    }
  }
}
