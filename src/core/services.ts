import type { NewIssueInput } from "./domain/create";
import type { IssuePatch } from "./domain/issueFile";
import type { Issue } from "./domain/types";

/** Who is acting on a ticket; `agent` marks writes made on behalf of an agent (gates land in 3.1). */
export interface TicketActor {
  author?: string;
  agent?: boolean;
}

export interface TicketQuery {
  /** Any of these statuses. */
  status?: string[];
  /** Project name (link form accepted). */
  project?: string;
  assignee?: string;
  /** Has this tag. */
  tag?: string;
  /** Direct children of this issue id. */
  parent?: string;
  /** Case-insensitive match on id or title. */
  text?: string;
}

/** Published by the tickets module; IssueStore stays the only writer behind it. */
export interface TicketService {
  get(id: string): Issue | undefined;
  list(query?: TicketQuery): Issue[];
  create(input: NewIssueInput, actor?: TicketActor): Promise<Issue>;
  update(id: string, patch: IssuePatch, actor?: TicketActor): Promise<Issue>;
  comment(id: string, body: string, actor?: Pick<TicketActor, "author">): Promise<Issue>;
  childrenOf(id: string): Issue[];
  /** Called after every index change; returns an unsubscribe function. */
  subscribe(cb: () => void): () => void;
}

/** Agent state of a terminal session. `exited` covers both an ended process and a restored (stopped) row. */
export type SessionState = "idle" | "working" | "needs-input" | "finished" | "exited";

export interface SessionInfo {
  id: string;
  kind: "shell" | "claude";
  title: string;
  cwd: string;
  state: SessionState;
  /** Claude conversation id, once a hook reported it. */
  claudeSessionId?: string;
}

export interface SpawnSessionOptions {
  /** Defaults to the vault root. */
  cwd?: string;
  /** Typed into the shell once it is up (a Claude session when it starts with `claude`, else a plain shell). */
  command?: string;
  args?: string[];
  /** Extra environment for the shell process. */
  env?: Record<string, string>;
  /** Pins the session's title in the sidebar. */
  title?: string;
}

/** Published by the term module. */
export interface SessionService {
  list(): SessionInfo[];
  get(id: string): SessionInfo | undefined;
  spawn(opts: SpawnSessionOptions): SessionInfo;
  /** Reveals the terminal view and selects the session. */
  focus(id: string): Promise<void>;
  /** The last `lines` lines of a session's terminal as plain text (no escape codes); empty when unknown. */
  tail(id: string, lines?: number): string;
  /** Kills the process if running and removes the session. */
  close(id: string): void;
  /** Fires on every state change; returns an unsubscribe function. */
  onState(cb: (info: SessionInfo, prev: SessionState) => void): () => void;
}

/** Stub service interfaces; modules fill these in as they land (logs 4.x, brain 7.x). */
export interface LogService {}
export interface BrainService {}

/** Typed map of cross-module services. A module's service is absent while that module is off. */
export interface Services {
  tickets: TicketService;
  sessions: SessionService;
  logs: LogService;
  brain: BrainService;
}

export class ServiceRegistry {
  private impls = new Map<keyof Services, unknown>();

  register<K extends keyof Services>(key: K, impl: Services[K]): void {
    this.impls.set(key, impl);
  }

  get<K extends keyof Services>(key: K): Services[K] | undefined {
    return this.impls.get(key) as Services[K] | undefined;
  }

  unregister(key: keyof Services): void {
    this.impls.delete(key);
  }
}
