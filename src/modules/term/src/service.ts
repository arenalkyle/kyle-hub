import type { EventBus, SessionInfo, SessionService, SessionState, SpawnSessionOptions } from "../../../core";
import type { Session, SessionManager } from "./session-manager";

/** What the service needs from the host (the parts that touch Obsidian or settings). */
export interface ServiceHost {
  /** The session manager, or an error message when it cannot start (e.g. Node missing). */
  getSessions(): SessionManager | string;
  defaultProfileId(): string;
  vaultRoot(): string;
  /** Reveals the terminal view. */
  activateView(): Promise<void>;
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

const quote = (a: string): string => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

export function toInfo(m: SessionManager, s: Session): SessionInfo {
  const info: SessionInfo = {
    id: s.id,
    kind: s.kind,
    title: m.title(s),
    cwd: s.cwd,
    state: s.agent.state,
  };
  if (s.agent.claudeSessionId) info.claudeSessionId = s.agent.claudeSessionId;
  return info;
}

/** Publishes the session manager as the core `SessionService`. */
export function createSessionService(host: ServiceHost, addStateListener: (cb: (s: Session, prev: SessionState) => void) => () => void): SessionService {
  const need = (): SessionManager => {
    const m = host.getSessions();
    if (typeof m === "string") throw new Error(m);
    return m;
  };
  const peek = (): SessionManager | undefined => {
    const m = host.getSessions();
    return typeof m === "string" ? undefined : m;
  };
  return {
    list() {
      const m = peek();
      return m ? m.list().map((s) => toInfo(m, s)) : [];
    },
    get(id) {
      const m = peek();
      const s = m?.get(id);
      return m && s ? toInfo(m, s) : undefined;
    },
    spawn(opts: SpawnSessionOptions) {
      const m = need();
      const command = opts.command ? [opts.command, ...(opts.args ?? []).map(quote)].join(" ") : undefined;
      const s = m.create({
        kind: command ? "claude" : "shell",
        profileId: host.defaultProfileId(),
        cwd: opts.cwd ?? host.vaultRoot(),
        command,
        env: opts.env,
        title: opts.title,
      });
      return toInfo(m, s);
    },
    async focus(id) {
      const m = need();
      if (!m.get(id)) return;
      await host.activateView();
      m.setActive(id);
    },
    tail(id, lines = 20) {
      const text = peek()?.term(id)?.serialize?.(lines) ?? "";
      return text.replace(ANSI, "").replace(/\r/g, "");
    },
    close(id) {
      peek()?.close(id);
    },
    onState(cb) {
      return addStateListener((s, prev) => {
        const m = peek();
        if (m) cb(toInfo(m, s), prev);
      });
    },
  };
}

/** Emits `session:*` bus events from a session manager's lifecycle and state changes. Returns a disposer. */
export function wireSessionEvents(m: SessionManager, bus: EventBus): () => void {
  const payload = (s: Session) => (s.agent.claudeSessionId ? { sessionId: s.id, claudeSessionId: s.agent.claudeSessionId } : { sessionId: s.id });
  const offs = [
    m.onLifecycle((kind, s) => bus.emit(kind === "started" ? "session:started" : "session:ended", payload(s))),
    m.onStateChange((s, _prev, next) => {
      if (next === "needs-input") bus.emit("session:needs-attention", payload(s));
    }),
  ];
  return () => offs.forEach((off) => off());
}
