import type { FpsChoice } from "./domain/fps";
import type { UsageWindowName } from "./domain/usage";
import type { AttentionReason } from "./services";

export interface BrainAccessEvent {
  t: string;
  sessionId: string;
  parentSessionId?: string;
  agentType?: string;
  kind: "read" | "write" | "search";
  path?: string;
  pattern?: string;
  hits?: number;
  /** Working directory of the session, for naming agents that have no terminal pane. */
  cwd?: string;
}

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
  /** An account crossed the warning level in a window (once per window instance). */
  "usage:threshold": { accountId: string; window: UsageWindowName; percent: number; windowStart: string };
  /** A Claude agent read, wrote or searched the vault (paths vault-relative; never contents). `sessionId` is the sub-agent id when `parentSessionId` is set. */
  "brain:access": BrainAccessEvent;
  /** A sub-agent started or stopped (`sessionId` is the parent terminal session, `agentId` matches the sub-agent id of `brain:access`). */
  "subagent:started": { sessionId: string; agentId: string; agentType?: string };
  "subagent:ended": { sessionId: string; agentId: string };
  "brain:health-changed": { scope: "repo" | "vault"; key: string; score: number; previous?: number };
  /** The user opened a vault note (`t` ISO, vault-relative `path`); emitted with the human spool record (LOCK-66). */
  "brain:human-open": { t: string; path: string };
  /** The shared animation FPS setting changed (LOCK-66); read it with `normalizeFps`. */
  "display:fps-changed": { fps: FpsChoice };
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
