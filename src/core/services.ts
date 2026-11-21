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

/** Stub service interfaces; modules fill these in as they land (term 2.1, logs 4.x, brain 7.x). */
export interface SessionService {}
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
