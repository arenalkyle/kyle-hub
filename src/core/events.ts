import type { AttentionReason } from "./services";

/** Typed event map; payloads are filled in as the emitting modules land. */
export interface HubEvents {
  "ticket:created": { id: string };
  "ticket:status-changed": { id: string; from: string; to: string };
  "ticket:label-changed": { id: string; added: string[]; removed: string[] };
  /** `claudeSessionId` is present once a hook has reported it (usually not yet at start). */
  "session:started": { sessionId: string; claudeSessionId?: string };
  "session:ended": { sessionId: string; claudeSessionId?: string };
  /** `ticketId`/`runId`/`reason` are present for launched runs. */
  "session:needs-attention": { sessionId: string; claudeSessionId?: string; ticketId?: string; runId?: string; reason?: AttentionReason };
  /** The attention state of a launched run ended (state changed, session closed). */
  "session:attention-cleared": { sessionId: string; ticketId?: string; runId?: string };
  /** A launched run's session ended and its outcome was recorded. */
  "run:finished": { runId: string; ticketId: string; outcome: string; summary: "agent" | "mechanical" };
  "run:ingested": { runId: string };
  "retro:completed": { retroId: string };
  /** Score changed for one repo (`key` = repo-map key) or the vault (`key` = `vault`). */
  "brain:health-changed": { scope: "repo" | "vault"; key: string; score: number; previous?: number };
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
