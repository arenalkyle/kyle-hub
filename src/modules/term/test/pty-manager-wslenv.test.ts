import { afterEach, describe, expect, it, vi } from "vitest";
import { PtyManager } from "../src/pty-manager";
import type { ToHelper } from "../src/protocol";

/** Captures what spawnSession would send to the helper, without starting it. */
function capture(platform: NodeJS.Platform, wslenv?: string): Extract<ToHelper, { t: "spawn" }> {
  vi.spyOn(process, "platform", "get").mockReturnValue(platform);
  if (wslenv === undefined) vi.stubEnv("WSLENV", ""); else vi.stubEnv("WSLENV", wslenv);
  const pm = new PtyManager("node", "helper.js");
  const sent: ToHelper[] = [];
  const any = pm as unknown as { ensureHelper(): void; send(m: ToHelper): void };
  any.ensureHelper = () => {};
  any.send = (m) => { sent.push(m); };
  pm.spawnSession(
    { shell: "wsl.exe", args: ["-d", "Ubuntu"], cwd: "x", cols: 80, rows: 24, env: { KYLE_TERM_SESSION: "s1", KYLE_TERM_PORT: "5", KYLE_TERM_TOKEN: "t", KYLE_TERM_WSL_HOST: "172.20.0.1:5", KH_TICKET: "K-1" } },
    { onData: () => {}, onExit: () => {} },
  );
  return sent[0] as Extract<ToHelper, { t: "spawn" }>;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("PtyManager env for WSL shells", () => {
  it("on Windows, forwards KYLE_TERM_* and KH_* into wsl.exe via WSLENV, keeping the user's entries", () => {
    const m = capture("win32", "USERPROFILE/p");
    expect(m.env.WSLENV).toBe("USERPROFILE/p:KYLE_TERM_SESSION/u:KYLE_TERM_PORT/u:KYLE_TERM_TOKEN/u:KYLE_TERM_WSL_HOST/u:KH_TICKET/u");
    expect(m.env).toMatchObject({ KYLE_TERM_SESSION: "s1", KH_TICKET: "K-1" });
  });
  it("elsewhere, leaves WSLENV alone", () => {
    expect(capture("darwin").env.WSLENV ?? "").toBe("");
    expect(capture("linux").env.WSLENV ?? "").toBe("");
  });
});
