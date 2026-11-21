import type { HubEvents, SessionState } from "../../../core";
import { StallDetector, type AttentionTracker } from "./attention";
import type { EndResult, SessionEnd } from "./sessionEnd";
import type { RunInfo, RunRegistry } from "./runs";

export interface WatcherDeps {
  registry: RunRegistry;
  tracker: AttentionTracker;
  stall: StallDetector;
  /** Runs the end-of-run handler (`finishRun` with real deps). */
  finish: (run: RunInfo, end: SessionEnd) => Promise<EndResult | undefined>;
  emit: <K extends "run:finished">(event: K, payload: HubEvents[K]) => void;
}

/** `SessionEnd` reasons that mean the run is over; `clear` / `resume` keep the session going. */
const ENDING = new Set(["prompt_input_exit", "logout", "other", "bypass_permissions_disabled"]);
const USER_CLOSED = new Set(["prompt_input_exit", "logout", "other"]);
const BUSY_EVENTS = new Set(["UserPromptSubmit", "PreToolUse", "PostToolUse", "SubagentStart", "SubagentStop"]);

/** Glue from hook events, session states and process exits of launched runs to the end-of-run handler. */
export class RunWatcher {
  private readonly done = new Set<string>();

  constructor(private readonly d: WatcherDeps) {}

  /** A hook event from `kyle-hook.js`; ignored unless the session is (or carries the env of) a launched run. */
  onHook(sessionId: string, event: string, payload: Record<string, unknown>, env: Record<string, string> | undefined): void {
    const cwd = typeof payload.cwd === "string" ? payload.cwd : undefined;
    const run = this.d.registry.fromHook(sessionId, env, cwd);
    if (!run) return;
    if (event === "SessionEnd") {
      const reason = typeof payload.reason === "string" ? payload.reason : "other";
      if (!ENDING.has(reason)) return;
      const claudeSessionId = typeof payload.session_id === "string" ? payload.session_id : undefined;
      void this.end(run, { closedByUser: USER_CLOSED.has(reason), claudeSessionId });
      return;
    }
    this.d.tracker.clear(sessionId, "stalled");
    if (BUSY_EVENTS.has(event)) this.d.stall.touch(sessionId);
    else if (event === "Stop") this.d.stall.stop(sessionId);
  }

  /** A session's agent state changed. */
  onState(sessionId: string, next: SessionState): void {
    const run = this.d.registry.get(sessionId);
    if (!run) return;
    const { tracker, stall } = this.d;
    if (next === "needs-input") {
      stall.stop(sessionId);
      tracker.raise(sessionId, run, "needs-input");
    } else if (next === "working") {
      tracker.clear(sessionId);
      stall.touch(sessionId);
    } else {
      stall.stop(sessionId);
      tracker.clear(sessionId, "needs-input");
      tracker.clear(sessionId, "stalled");
    }
  }

  /** The session's process exited or the session was closed (`exitCode` undefined = closed by the user). */
  onExit(sessionId: string, exitCode?: number): void {
    const run = this.d.registry.get(sessionId);
    if (!run) return;
    void this.end(run, { exitCode, closedByUser: exitCode === undefined || exitCode === 0 });
  }

  /** The ticket's status changed: its "no agent summary" badge has served its purpose. */
  onTicketStatusChanged(ticketId: string): void {
    this.d.tracker.clearTicket(ticketId);
  }

  /** Called on an interval: raises `stalled` for working sessions that went quiet. */
  tick(): void {
    for (const id of this.d.stall.stalled()) {
      const run = this.d.registry.get(id);
      if (run) this.d.tracker.raise(id, run, "stalled");
    }
  }

  private async end(run: RunInfo, end: SessionEnd): Promise<void> {
    if (this.done.has(run.runId)) return;
    this.done.add(run.runId);
    const { tracker, stall } = this.d;
    stall.stop(run.sessionId);
    tracker.clear(run.sessionId);
    try {
      const res = await this.d.finish(run, end);
      if (!res) return;
      this.d.emit("run:finished", { runId: run.runId, ticketId: run.ticketId, outcome: res.outcome, summary: res.summary });
      if (res.needsAttention) tracker.raise(run.sessionId, run, res.needsAttention);
    } catch (e) {
      console.error(`kyle-hub: finishing run ${run.runId} failed`, e);
    }
  }
}
