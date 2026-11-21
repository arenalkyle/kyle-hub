import type { NewIssueInput } from "./domain/create";
import type { IssuePatch } from "./domain/issueFile";
import type { Issue, StatusDef } from "./domain/types";

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
  /** Appends an activity event with no field change. */
  logEvent(id: string, text: string, actor?: Pick<TicketActor, "author">): Promise<Issue>;
  /** Removes a comment by id. */
  removeComment(id: string, commentId: string): Promise<Issue>;
  childrenOf(id: string): Issue[];
  /** Queued tickets (agent-ready, unstarted, unblocked) in launch order: priority, then `sortOrder`. */
  queue(): Issue[];
  statuses(): StatusDef[];
  /** The repo-map key of a ticket: its own `repo`, else its project's. */
  repoOf(id: string): string | undefined;
  /** Markdown body of the ticket's project (undefined when it has none). */
  projectDescription(id: string): string | undefined;
  /** Display name of the acting user (no `@`). */
  userName(): string;
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

import type { LogService } from "./logs/types";
export type { LogService } from "./logs/types";

export type AttentionReason = "needs-input" | "stalled" | "no agent summary";

/** A launched run that needs a human; transient view state, never written to ticket files. */
export interface AttentionInfo {
  sessionId: string;
  ticketId: string;
  runId: string;
  reason: AttentionReason;
  /** Epoch ms when it was raised. */
  since: number;
}

/** Published by the term module: which tickets have a run needing attention. */
export interface AttentionService {
  get(ticketId: string): AttentionInfo | undefined;
  list(): AttentionInfo[];
  /** Reveals the session of the ticket's run. */
  focus(ticketId: string): Promise<void>;
  /** Fires whenever the set changes; returns an unsubscribe function. */
  subscribe(cb: () => void): () => void;
}

export interface RetroStatus {
  /** Latest retro across profiles (ISO), if any. */
  lastRetroAt?: string;
  sessionsSince: number;
  nudgeAt: number;
}

export interface RetroSummary {
  created: { id: string; title: string; type: string }[];
  seenAgain: string[];
  skipped: string[];
  recurred: string[];
  resolved: string[];
}

export interface RuleDraft {
  rule: string;
  diff: string;
  root: string;
  costUsd: number;
}

/** Published by the term module: the retro loop (6.2). Ticket-page buttons call it; the term sidebar shows the status. */
export interface RetroService {
  status(): Promise<RetroStatus>;
  perform(): Promise<RetroSummary>;
  /** Apply button: an accepted, open proposal with a diff that was not applied yet. */
  canApply(id: string): boolean;
  apply(id: string): Promise<{ ok: boolean; message: string }>;
  /** Draft rule button: only when `allowDraftRule` is on and the ticket is a user_correction finding. */
  canDraft(id: string): boolean;
  draft(id: string): Promise<{ ok: true; draft: RuleDraft } | { ok: false; message: string }>;
  confirmDraft(id: string, draft: RuleDraft): Promise<void>;
  /** Fires after a retro or an apply; returns an unsubscribe function. */
  subscribe(cb: () => void): () => void;
}

import type { BrainService } from "./brain/service";
export type { BrainService };

/** Typed map of cross-module services. A module's service is absent while that module is off. */
export interface Services {
  tickets: TicketService;
  sessions: SessionService;
  logs: LogService;
  attention: AttentionService;
  retro: RetroService;
  brain: BrainService;
  promote: PromoteService;
}

/** Work -> home promotion (ADR-0008): scrub, show the diff, write only on confirm. */
export interface PromoteService {
  /** Opens the diff modal for `text` (a work lesson or applied proposal); returns a refusal reason, or undefined when opened. */
  open(name: string, text: string): string | undefined;
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
