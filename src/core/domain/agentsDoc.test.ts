import { describe, expect, it } from "vitest";
import { AGENTS_MARKER, isGeneratedAgentsDoc, renderAgentsDoc } from "./agentsDoc";
import { defaultSettings } from "./defaults";

describe("renderAgentsDoc", () => {
  const s = { ...defaultSettings(), prefix: "E2E", displayName: "ann" };
  const doc = renderAgentsDoc(s);
  it("has the marker, prefix and display name", () => {
    expect(doc.startsWith(AGENTS_MARKER)).toBe(true);
    expect(doc).toContain("E2E-");
    expect(doc).not.toContain("TIX-");
    expect(doc).toContain("@ann");
  });
  it("lists every status", () => {
    for (const st of s.statuses) expect(doc).toContain(`\`${st.name}\``);
  });
  it("follows custom statuses and stays short", () => {
    const d = renderAgentsDoc({ ...s, statuses: [{ name: "Open", category: "unstarted", color: "#fff", order: 0 }, { name: "Shipped", category: "completed", color: "#000", order: 1 }], defaultStatus: "Open" });
    expect(d).toContain("`Shipped`");
    expect(d).not.toContain("`Triage`");
    expect(doc.split("\n").length).toBeLessThan(120);
  });
  it("detects generated files", () => {
    expect(isGeneratedAgentsDoc(doc)).toBe(true);
    expect(isGeneratedAgentsDoc("# mine")).toBe(false);
  });
});
