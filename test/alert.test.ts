import { describe, expect, it } from "vitest";
import { decideAlert, nextAttention, DEFAULT_SOUNDS, type AlertInput } from "../src/alert";

const base = (o: Partial<AlertInput> = {}): AlertInput => ({
  event: "needs-input", sessionId: "a", now: 10_000, sounds: structuredClone(DEFAULT_SOUNDS), viewing: false,
  lastPlayed: { bySession: {}, byEvent: {} }, ...o,
});

describe("decideAlert", () => {
  it("plays defaults with master x event volume", () => {
    expect(decideAlert(base())).toEqual({ sound: "chime", volume: 0.8 });
    const s = structuredClone(DEFAULT_SOUNDS);
    s.master = 50;
    expect(decideAlert(base({ event: "finished", sounds: s }))).toEqual({ sound: "ping", volume: 0.25 });
  });
  it("is silent when muted, viewing, or none is selected (sub-agent default)", () => {
    const m = structuredClone(DEFAULT_SOUNDS);
    m.muted = true;
    expect(decideAlert(base({ sounds: m }))).toBeNull();
    expect(decideAlert(base({ viewing: true }))).toBeNull();
    expect(decideAlert(base({ event: "sub-agent-done" }))).toBeNull();
  });
  it("debounces per session and per event type within 1 s", () => {
    const now = 10_000;
    expect(decideAlert(base({ lastPlayed: { bySession: { "needs-input:a": now - 500 }, byEvent: {} } }))).toBeNull();
    expect(decideAlert(base({ sessionId: "b", lastPlayed: { bySession: {}, byEvent: { "needs-input": now - 500 } } }))).toBeNull();
    expect(decideAlert(base({ lastPlayed: { bySession: { "needs-input:a": now - 1000 }, byEvent: { "needs-input": now - 1500 } } }))).not.toBeNull();
  });
  it("a different event type is not debounced by another", () => {
    expect(decideAlert(base({ event: "finished", lastPlayed: { bySession: {}, byEvent: { "needs-input": 9_900 } } }))).not.toBeNull();
  });
  it("passes through vault sounds", () => {
    const s = structuredClone(DEFAULT_SOUNDS);
    s.events["needs-input"].sound = "vault:a/b.mp3";
    expect(decideAlert(base({ sounds: s }))?.sound).toBe("vault:a/b.mp3");
  });
});

describe("nextAttention", () => {
  const s = (...st: string[]) => st.map((state, i) => ({ id: `s${i}`, state }));
  it("returns null when nothing waits", () => expect(nextAttention(s("idle", "working"), null)).toBeNull());
  it("prefers needs-input in sidebar order over finished", () => {
    expect(nextAttention(s("finished", "needs-input", "needs-input"), null)).toBe("s1");
  });
  it("cycles after the current session", () => {
    const l = s("needs-input", "idle", "needs-input");
    expect(nextAttention(l, "s0")).toBe("s2");
    expect(nextAttention(l, "s2")).toBe("s0");
    expect(nextAttention(l, "s1")).toBe("s0");
  });
  it("falls back to finished", () => {
    expect(nextAttention(s("idle", "finished", "finished"), "s1")).toBe("s2");
  });
});
