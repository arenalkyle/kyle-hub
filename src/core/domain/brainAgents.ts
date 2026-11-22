import type { BrainAccessEvent } from "../events";

/** Idle time before an agent starts fading, and how long the fade lasts before it is removed. */
export const AGENT_IDLE_MS = 120_000;
export const AGENT_FADE_MS = 10_000;

/** What the terminal knows about a session; all optional (a session with no pane has none of it). */
export interface AgentIdentity {
  title?: string;
  /** Pane colour tag, a CSS colour in hex form. */
  color?: string;
  cwd?: string;
  kind?: "shell" | "claude";
}
export type IdentityLookup = (sessionId: string) => AgentIdentity | undefined;

export interface Agent {
  id: string;
  parentId?: string;
  name: string;
  color: string;
  /** Epoch ms of the last access or lifecycle event. */
  lastActive: number;
  /** Vault-relative path of the last note read or written. */
  note?: string;
  noteKind?: "read" | "write";
  /** Bumped on every read/write so views can detect a new visit to the same note. */
  visits: number;
}
export type Agents = ReadonlyMap<string, Agent>;

/** Session palette for panes without a colour tag. Blue and green stay free: on a pane they mean needs-input and finished. */
const PALETTE = ["#e08a2c", "#a371f7", "#22c3d6", "#ec5fa8", "#d4b106", "#e5534b", "#a5d32a", "#9c6b4e"] as const;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The same session id always maps to the same palette colour. */
export function hashColor(sessionId: string): string {
  return PALETTE[hash(sessionId) % PALETTE.length]!;
}

/** Mixes a `#rrggbb` colour towards white; unparseable input is returned unchanged. */
export function lighten(hex: string, amount = 0.45): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const ch = (shift: number): string => Math.round(((n >> shift) & 255) * (1 - amount) + 255 * amount).toString(16).padStart(2, "0");
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

const folderOf = (cwd: string | undefined): string => {
  const parts = (cwd ?? "").split(/[\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? "claude";
};

/** Pane title, else `folder·shortid` (e.g. `locked-away·3f2a`). */
export function sessionName(id: string, identity: AgentIdentity | undefined): string {
  const title = identity?.title?.trim();
  return title || `${folderOf(identity?.cwd)}·${id.slice(-4)}`;
}

function upsertSession(map: Map<string, Agent>, id: string, now: number, lookup: IdentityLookup, cwd?: string): Agent {
  const found = lookup(id);
  const identity: AgentIdentity = { ...found, cwd: found?.cwd ?? cwd };
  const prev = map.get(id);
  const agent: Agent = {
    id,
    name: sessionName(id, identity),
    color: identity.color ?? hashColor(id),
    lastActive: now,
    visits: prev?.visits ?? 0,
    ...(prev?.note !== undefined ? { note: prev.note } : {}),
    ...(prev?.noteKind ? { noteKind: prev.noteKind } : {}),
  };
  map.set(id, agent);
  return agent;
}

/** A session started: shows a Claude session straight away (shells and unknown ids are ignored). */
export function startSession(agents: Agents, sessionId: string, now: number, lookup: IdentityLookup): Agents {
  if (lookup(sessionId)?.kind !== "claude") return agents;
  const next = new Map(agents);
  upsertSession(next, sessionId, now, lookup);
  return next;
}

/** A session ended: it and its sub-agents disappear. */
export function endSession(agents: Agents, sessionId: string): Agents {
  if (!agents.has(sessionId) && ![...agents.values()].some((a) => a.parentId === sessionId)) return agents;
  const next = new Map(agents);
  next.delete(sessionId);
  for (const a of agents.values()) if (a.parentId === sessionId) next.delete(a.id);
  return next;
}

/** A `brain:access` event: creates or refreshes the agent, and its parent when it is a sub-agent. */
export function applyAccess(agents: Agents, e: BrainAccessEvent, now: number, lookup: IdentityLookup): Agents {
  const next = new Map(agents);
  let agent: Agent;
  if (e.parentSessionId) {
    const parent = upsertSession(next, e.parentSessionId, now, lookup, e.cwd);
    const prev = next.get(e.sessionId);
    agent = {
      id: e.sessionId,
      parentId: parent.id,
      name: `${parent.name} › ${e.agentType ?? "agent"}`,
      color: lighten(parent.color),
      lastActive: now,
      visits: prev?.visits ?? 0,
      ...(prev?.note !== undefined ? { note: prev.note } : {}),
      ...(prev?.noteKind ? { noteKind: prev.noteKind } : {}),
    };
    next.set(agent.id, agent);
  } else {
    agent = upsertSession(next, e.sessionId, now, lookup, e.cwd);
  }
  if (e.path && (e.kind === "read" || e.kind === "write")) {
    next.set(agent.id, { ...agent, note: e.path, noteKind: e.kind, visits: agent.visits + 1 });
  }
  return next;
}

/** 1 while active, falling to 0 over the fade; 0 means the agent should be gone. */
export function agentAlpha(a: Agent, now: number): number {
  const idle = now - a.lastActive;
  if (idle <= AGENT_IDLE_MS) return 1;
  return Math.max(0, 1 - (idle - AGENT_IDLE_MS) / AGENT_FADE_MS);
}

/** Drops agents that have faded out (and sub-agents whose parent is gone). Returns the same map when nothing changed. */
export function pruneAgents(agents: Agents, now: number): Agents {
  let next: Map<string, Agent> | undefined;
  for (const a of agents.values()) {
    if (agentAlpha(a, now) <= 0 || (a.parentId !== undefined && !agents.has(a.parentId))) (next ??= new Map(agents)).delete(a.id);
  }
  return next ?? agents;
}

/** `[subAgentId, parentId]` pairs for lines between sub-agents and parents while both are active. */
export function tethers(agents: Agents, now: number): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const a of agents.values()) {
    const p = a.parentId ? agents.get(a.parentId) : undefined;
    if (p && now - a.lastActive <= AGENT_IDLE_MS && now - p.lastActive <= AGENT_IDLE_MS) out.push([a.id, p.id]);
  }
  return out;
}
