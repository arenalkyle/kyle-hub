import type { Agent, Agents } from "./brainAgents";

/** Short ID shown next to a tag: the first three characters of the session id. */
export const shortId = (id: string): string => id.slice(0, 3);

/**
 * Display names for name tags and toasts. A session shows its pane title, with ` · <id>` added only when another live session shares
 * that title; a session with no pane shows `folder · <id>`. A sub-agent shows `parent › agent-type`.
 */
export function tagNames(agents: Agents): Map<string, string> {
  const sessions: Agent[] = [];
  for (const a of agents.values()) if (!a.parentId) sessions.push(a);
  const count = new Map<string, number>();
  for (const a of sessions) if (a.titled !== false) count.set(a.name, (count.get(a.name) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const a of sessions) {
    if (a.titled === false) out.set(a.id, `${a.folder ?? "claude"} · ${shortId(a.id)}`);
    else out.set(a.id, (count.get(a.name) ?? 0) > 1 ? `${a.name} · ${shortId(a.id)}` : a.name);
  }
  for (const a of agents.values()) {
    if (!a.parentId) continue;
    const parent = out.get(a.parentId);
    out.set(a.id, parent ? `${parent} › ${a.agentType ?? "agent"}` : a.name);
  }
  return out;
}
