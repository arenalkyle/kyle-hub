import type { BrainAccessEvent } from "../events";

/**
 * Sessions stay for their whole life (no idle fade). A moon is removed on `subagent:ended`; this is only a safety net for a missed stop event: dropped after this long
 * without an access (it comes back on the next one). It is also dropped with its parent.
 */
export const SUBAGENT_IDLE_MS = 10 * 60_000;

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
  /** Stable orbit slot: among live sessions for a session, among its siblings for a sub-agent (moon). Never changes while the agent lives. */
  slot: number;
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

/** First palette colour from the id's hash that no live agent uses; the hash colour when all are taken. */
export function uniqueColor(sessionId: string, taken: ReadonlySet<string>): string {
  const start = hash(sessionId) % PALETTE.length;
  for (let i = 0; i < PALETTE.length; i++) {
    const c = PALETTE[(start + i) % PALETTE.length]!;
    if (!taken.has(c)) return c;
  }
  return PALETTE[start]!;
}

/** Lowest slot not used by `others`. */
function freeSlot(others: Iterable<Agent>): number {
  const used = new Set<number>();
  for (const a of others) used.add(a.slot);
  let n = 0;
  while (used.has(n)) n++;
  return n;
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
  const others = [...map.values()].filter((a) => a.id !== id);
  const agent: Agent = {
    id,
    name: sessionName(id, identity),
    color: identity.color ?? prev?.color ?? uniqueColor(id, new Set(others.map((a) => a.color))),
    lastActive: now,
    slot: prev?.slot ?? freeSlot(others.filter((a) => !a.parentId)),
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

function upsertSub(next: Map<string, Agent>, id: string, parentId: string, agentType: string | undefined, now: number, lookup: IdentityLookup, cwd?: string): Agent {
  const parent = upsertSession(next, parentId, now, lookup, cwd);
  const prev = next.get(id);
  const agent: Agent = {
    id,
    parentId: parent.id,
    name: `${parent.name} › ${agentType ?? "agent"}`,
    color: lighten(parent.color),
    lastActive: now,
    slot: prev?.slot ?? freeSlot([...next.values()].filter((a) => a.parentId === parent.id)),
    visits: prev?.visits ?? 0,
    ...(prev?.note !== undefined ? { note: prev.note } : {}),
    ...(prev?.noteKind ? { noteKind: prev.noteKind } : {}),
  };
  next.set(id, agent);
  return agent;
}

/** A sub-agent started (`subagent:started`): its moon appears around the parent straight away. */
export function startSubagent(agents: Agents, parentId: string, agentId: string, agentType: string | undefined, now: number, lookup: IdentityLookup): Agents {
  const next = new Map(agents);
  upsertSub(next, agentId, parentId, agentType, now, lookup);
  return next;
}

/** A sub-agent finished (`subagent:ended`): its moon is removed. */
export function endSubagent(agents: Agents, agentId: string): Agents {
  if (!agents.get(agentId)?.parentId) return agents;
  const next = new Map(agents);
  next.delete(agentId);
  return next;
}

/** A `brain:access` event: creates or refreshes the agent, and its parent when it is a sub-agent. */
export function applyAccess(agents: Agents, e: BrainAccessEvent, now: number, lookup: IdentityLookup): Agents {
  const next = new Map(agents);
  const agent = e.parentSessionId
    ? upsertSub(next, e.sessionId, e.parentSessionId, e.agentType, now, lookup, e.cwd)
    : upsertSession(next, e.sessionId, now, lookup, e.cwd);
  if (e.path && (e.kind === "read" || e.kind === "write")) {
    next.set(agent.id, { ...agent, note: e.path, noteKind: e.kind, visits: agent.visits + 1 });
  }
  return next;
}

/** The zap an access event triggers: from the agent that did it (a moon for a sub-agent) to the note itself. Searches and path-less events zap nothing. */
export function zapOf(e: BrainAccessEvent): { agentId: string; path: string; kind: "read" | "write" } | undefined {
  if (!e.path || (e.kind !== "read" && e.kind !== "write")) return undefined;
  return { agentId: e.sessionId, path: e.path, kind: e.kind };
}

/** Drops sub-agents whose parent is gone or that have been idle too long. Sessions are never pruned. Returns the same map when nothing changed. */
export function pruneAgents(agents: Agents, now: number): Agents {
  let next: Map<string, Agent> | undefined;
  for (const a of agents.values()) {
    if (a.parentId !== undefined && (!agents.has(a.parentId) || now - a.lastActive > SUBAGENT_IDLE_MS)) (next ??= new Map(agents)).delete(a.id);
  }
  return next ?? agents;
}
