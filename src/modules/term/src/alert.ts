export type AlertEvent = "needs-input" | "finished" | "sub-agent-done";

/** "none", a built-in tone id, or `vault:<path>`. */
export type SoundChoice = string;

export const TONES = ["chime", "ping", "bell", "pulse"] as const;
export type ToneId = (typeof TONES)[number];

export interface EventSound {
  sound: SoundChoice;
  /** 0-100 */
  volume: number;
}

export interface SoundSettings {
  muted: boolean;
  /** 0-100 */
  master: number;
  events: Record<AlertEvent, EventSound>;
}

export const DEFAULT_SOUNDS: SoundSettings = {
  muted: false,
  master: 100,
  events: {
    "needs-input": { sound: "chime", volume: 80 },
    finished: { sound: "ping", volume: 50 },
    "sub-agent-done": { sound: "none", volume: 50 },
  },
};

export const DEBOUNCE_MS = 1000;

export interface AlertInput {
  event: AlertEvent;
  sessionId: string;
  now: number;
  sounds: SoundSettings;
  /** True when Obsidian has focus, the terminal tab is active and this session is visible. */
  viewing: boolean;
  /** Last time a sound played, per `${event}:${sessionId}` and per event. */
  lastPlayed: { bySession: Record<string, number>; byEvent: Partial<Record<AlertEvent, number>> };
}

export interface AlertDecision {
  sound: SoundChoice;
  /** Final volume, 0-1: master x event. */
  volume: number;
}

export const sessionKey = (event: AlertEvent, sessionId: string): string => `${event}:${sessionId}`;

const clamp = (n: number): number => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));

/** Pure: should this transition play a sound, and which? */
export function decideAlert(i: AlertInput): AlertDecision | null {
  if (i.sounds.muted || i.viewing) return null;
  const cfg = i.sounds.events[i.event];
  if (!cfg || cfg.sound === "none") return null;
  const s = i.lastPlayed.bySession[sessionKey(i.event, i.sessionId)];
  if (s !== undefined && i.now - s < DEBOUNCE_MS) return null;
  const e = i.lastPlayed.byEvent[i.event];
  if (e !== undefined && i.now - e < DEBOUNCE_MS) return null;
  const volume = (clamp(i.sounds.master) / 100) * (clamp(cfg.volume) / 100);
  return { sound: cfg.sound, volume };
}

export interface AttentionSession {
  id: string;
  state: string;
}

/**
 * Pure: next session to jump to. Needs-input sessions in sidebar order; if none, finished ones.
 * Cycles: continues after `currentId` when it is in the list, else starts at the first.
 */
export function nextAttention(sessions: readonly AttentionSession[], currentId: string | null): string | null {
  let list = sessions.filter((s) => s.state === "needs-input");
  if (list.length === 0) list = sessions.filter((s) => s.state === "finished");
  if (list.length === 0) return null;
  const i = list.findIndex((s) => s.id === currentId);
  return list[i < 0 ? 0 : (i + 1) % list.length]!.id;
}
