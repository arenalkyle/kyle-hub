export type AgentState = "idle" | "working" | "needs-input" | "finished" | "exited";

export interface SubAgent {
  id: string;
  type?: string;
  description?: string;
  status: "running" | "done";
  endedAt?: number;
}

export interface AgentInfo {
  state: AgentState;
  activity?: string;
  subAgents: SubAgent[];
  claudeSessionId?: string;
  firstPrompt?: string;
  hasHookEvents: boolean;
}

export type AgentEvent =
  | { type: "hook"; event: string; payload: Record<string, unknown>; at: number }
  | { type: "viewed" }
  | { type: "exit" }
  | { type: "bell" }
  | { type: "output" }
  | { type: "idle" };

/** Finished sub-agent lines disappear this long after they end. */
export const SUBAGENT_FADE_MS = 10_000;
const ANON = "anon-";

export function initialAgent(): AgentInfo {
  return { state: "idle", subAgents: [], hasHookEvents: false };
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
const trunc = (s: string, n: number): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function shortPath(p: string | undefined, cwd: string | undefined): string {
  if (!p) return "file";
  const norm = p.replace(/\\/g, "/");
  const base = cwd?.replace(/\\/g, "/").replace(/\/+$/, "");
  if (base && norm.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return norm.slice(base.length + 1);
  return norm.split("/").pop() || norm;
}

/** Plain-words description of a tool call. */
export function describeTool(tool: string, input: Record<string, unknown> | undefined, cwd?: string): string {
  const i = input ?? {};
  switch (tool) {
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return `Editing ${shortPath(str(i.file_path) ?? str(i.notebook_path), cwd)}`;
    case "Read":
      return `Reading ${shortPath(str(i.file_path), cwd)}`;
    case "Bash": {
      const c = str(i.command);
      return c ? `Running ${trunc(c, 60)}` : "Running command";
    }
    case "Grep": {
      const p = str(i.pattern);
      return p ? `Searching for '${trunc(p, 40)}'` : "Searching…";
    }
    case "Glob": {
      const p = str(i.pattern);
      return p ? `Searching files: ${trunc(p, 40)}` : "Searching…";
    }
    case "Agent":
    case "Task": {
      const d = str(i.description) ?? str(i.subagent_type);
      return d ? `Starting sub-agent: ${trunc(d, 50)}` : "Starting sub-agent";
    }
    default:
      return tool || "Working";
  }
}

function prune(subs: SubAgent[], at: number): SubAgent[] {
  const kept = subs.filter((s) => s.status === "running" || at - (s.endedAt ?? at) < SUBAGENT_FADE_MS);
  return kept.length === subs.length ? subs : kept;
}

function stopSub(subs: SubAgent[], id: string | undefined, at: number): SubAgent[] {
  let idx = id ? subs.findIndex((s) => s.id === id && s.status === "running") : -1;
  if (idx < 0) idx = subs.findIndex((s) => s.status === "running");
  if (idx < 0) return subs;
  return subs.map((s, n) => (n === idx ? { ...s, status: "done" as const, endedAt: at } : s));
}

function reduceHook(info: AgentInfo, event: string, p: Record<string, unknown>, at: number): AgentInfo {
  const base: AgentInfo = { ...info, hasHookEvents: true, subAgents: prune(info.subAgents, at) };
  switch (event) {
    case "SessionStart": {
      const id = str(p.session_id);
      return id ? { ...base, claudeSessionId: id } : base;
    }
    case "UserPromptSubmit": {
      const prompt = str(p.prompt);
      return { ...base, state: "working", activity: undefined, firstPrompt: base.firstPrompt ?? prompt };
    }
    case "PreToolUse": {
      const tool = str(p.tool_name) ?? "";
      const input = p.tool_input as Record<string, unknown> | undefined;
      let subAgents = base.subAgents;
      if (tool === "Agent" || tool === "Task") {
        subAgents = [
          ...subAgents,
          {
            id: `${ANON}${at}-${subAgents.length}`,
            type: str(input?.subagent_type),
            description: str(input?.description),
            status: "running",
          },
        ];
      }
      return { ...base, state: "working", activity: describeTool(tool, input, str(p.cwd)), subAgents };
    }
    case "PostToolUse":
      return { ...base, state: "working" };
    case "Notification":
      // Only mid-turn notifications (permission prompts, questions) need the user. Claude Code also
      // sends an "idle_prompt" Notification when the prompt sits unused, even before any prompt.
      if (info.state !== "working" || p.notification_type === "idle_prompt") return base;
      return { ...base, state: "needs-input", activity: str(p.message) ? trunc(str(p.message)!, 80) : "Needs input" };
    case "Stop": {
      const subAgents = base.subAgents.map((s) =>
        s.status === "running" && s.id.startsWith(ANON) ? { ...s, status: "done" as const, endedAt: at } : s,
      );
      return { ...base, state: "finished", activity: undefined, subAgents };
    }
    case "SubagentStart": {
      const agentId = str(p.agent_id);
      const type = str(p.agent_type);
      const anon = base.subAgents.findIndex((s) => s.status === "running" && s.id.startsWith(ANON));
      if (anon >= 0 && agentId) {
        return {
          ...base,
          subAgents: base.subAgents.map((s, n) => (n === anon ? { ...s, id: agentId, type: type ?? s.type } : s)),
        };
      }
      const id = agentId ?? `${ANON}${at}-${base.subAgents.length}`;
      return { ...base, subAgents: [...base.subAgents, { id, type, status: "running" }] };
    }
    case "SubagentStop":
      return { ...base, subAgents: stopSub(base.subAgents, str(p.agent_id), at) };
    default:
      return base;
  }
}

/** Pure transition function: (info, event) -> info. */
export function reduceAgent(info: AgentInfo, ev: AgentEvent): AgentInfo {
  if (info.state === "exited") return info;
  switch (ev.type) {
    case "exit":
      return { ...info, state: "exited", activity: undefined };
    case "viewed":
      return info.state === "needs-input" || info.state === "finished" ? { ...info, state: "idle", activity: undefined } : info;
    case "hook":
      return reduceHook(info, ev.event, ev.payload, ev.at);
    case "bell":
      return info.hasHookEvents ? info : { ...info, state: "needs-input", activity: "Needs input" };
    case "output":
      return info.hasHookEvents || info.state === "needs-input" ? info : { ...info, state: "working" };
    case "idle":
      return info.hasHookEvents || info.state !== "working" ? info : { ...info, state: "finished" };
  }
}

export const runningCount = (i: AgentInfo): number => i.subAgents.filter((s) => s.status === "running").length;
