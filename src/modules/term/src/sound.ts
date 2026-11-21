import { Notice, type App } from "obsidian";
import { TONES, type SoundChoice, type ToneId } from "./alert";

export const AUDIO_EXTS = ["mp3", "wav", "ogg", "m4a"];
export const DEFAULT_TONE: ToneId = "chime";

interface Blip {
  freq: number;
  start: number;
  attack?: number;
  decay: number;
  gain?: number;
  type?: OscillatorType;
}

/** Tone recipes: short (< 1 s), generated in code, no audio assets. */
const RECIPES: Record<ToneId, Blip[]> = {
  chime: [
    { freq: 880, start: 0, decay: 0.4 },
    { freq: 1320, start: 0.12, decay: 0.4 },
  ],
  ping: [{ freq: 1500, start: 0, decay: 0.25 }],
  bell: [
    { freq: 660, start: 0, decay: 0.8 },
    { freq: 1650, start: 0, decay: 0.5, gain: 0.35 },
  ],
  pulse: [0, 0.16, 0.32].map((start) => ({ freq: 520, start, attack: 0.01, decay: 0.09, type: "triangle" as const })),
};

export class SoundPlayer {
  private ctx: AudioContext | null = null;
  private warned = new Set<string>();

  constructor(private app: App) {}

  private isTone(s: SoundChoice): s is ToneId {
    return (TONES as readonly string[]).includes(s);
  }

  /** volume 0-1 */
  play(sound: SoundChoice, volume: number): void {
    if (sound === "none" || volume <= 0) return;
    if (sound.startsWith("vault:")) return this.playFile(sound.slice(6), volume);
    this.playTone(this.isTone(sound) ? sound : DEFAULT_TONE, volume);
  }

  private playTone(id: ToneId, volume: number): void {
    try {
      this.ctx ??= new AudioContext();
      const ctx = this.ctx;
      if (ctx.state === "suspended") void ctx.resume();
      const t0 = ctx.currentTime;
      for (const b of RECIPES[id]) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = b.type ?? "sine";
        osc.frequency.value = b.freq;
        const peak = volume * (b.gain ?? 1) * 0.5;
        const at = t0 + b.start;
        const att = b.attack ?? 0.01;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.linearRampToValueAtTime(Math.max(peak, 0.0001), at + att);
        g.gain.exponentialRampToValueAtTime(0.0001, at + att + b.decay);
        osc.connect(g).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + att + b.decay + 0.05);
      }
    } catch (e) {
      console.error("[kyle-term] tone failed", e);
    }
  }

  private playFile(path: string, volume: number): void {
    let fell = false;
    const fallback = (): void => {
      if (fell) return;
      fell = true;
      if (!this.warned.has(path)) {
        this.warned.add(path);
        new Notice(`kyle-term: sound file not found or unplayable: ${path}. Using the default tone.`);
      }
      this.playTone(DEFAULT_TONE, volume);
    };
    try {
      if (!this.app.vault.getAbstractFileByPath(path)) return fallback();
      const audio = new Audio(this.app.vault.adapter.getResourcePath(path));
      audio.volume = Math.max(0, Math.min(1, volume));
      audio.onerror = fallback;
      audio.play().catch(fallback);
    } catch {
      fallback();
    }
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}
