import { spawnSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HookServer, type HookMessage } from "../src/hook-server";

let server: HookServer | undefined;
afterEach(() => { server?.stop(); server = undefined; });

function post(port: number, token: string | undefined, body: string, p = "/event"): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: p, method: "POST", headers: token ? { "x-kyle-token": token } : {} },
      (res) => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); },
    );
    req.on("error", reject);
    req.end(body);
  });
}

describe("HookServer", () => {
  it("accepts valid events, rejects bad/missing tokens with 401", async () => {
    const got: HookMessage[] = [];
    server = new HookServer((m) => got.push(m));
    const port = await server.start();
    const body = JSON.stringify({ session: "s1", event: "Stop", payload: { a: 1 } });
    expect(await post(port, server.token, body)).toBe(204);
    expect(await post(port, "wrong", body)).toBe(401);
    expect(await post(port, undefined, body)).toBe(401);
    expect(await post(port, server.token, body, "/other")).toBe(404);
    expect(await post(port, server.token, "not json")).toBe(400);
    expect(got).toEqual([{ session: "s1", event: "Stop", payload: { a: 1 } }]);
  });
  it("listens on loopback only with a fresh random token each instance", async () => {
    server = new HookServer(() => {});
    await server.start();
    const other = new HookServer(() => {});
    expect(other.token).not.toBe(server.token);
    expect(server.token.length).toBeGreaterThanOrEqual(32);
    const addr = await new Promise<string>((resolve) => {
      const s = http.createServer().listen(0, "127.0.0.1", () => { resolve("ok"); s.close(); });
    });
    expect(addr).toBe("ok");
  });
  it("listenOn adds a second listener with the same token check, falling back to a free port", async () => {
    const got: HookMessage[] = [];
    server = new HookServer((m) => got.push(m));
    const port = await server.start();
    // 127.0.0.1 is taken on `port` by the loopback listener, so this exercises the free-port fallback.
    const extra = await server.listenOn("127.0.0.1");
    expect(extra).not.toBe(port);
    expect(await server.listenOn("127.0.0.1")).toBe(extra);
    const body = JSON.stringify({ session: "s2", event: "Stop" });
    expect(await post(extra, "wrong", body)).toBe(401);
    expect(await post(extra, server.token, body)).toBe(204);
    expect(got.map((m) => m.session)).toEqual(["s2"]);
    server.stop();
    await expect(post(extra, server.token, body)).rejects.toThrow();
  });
});

describe("hooks/kyle-hook.js", () => {
  const script = path.resolve(__dirname, "../hooks/kyle-hook.js");
  const run = (env: Record<string, string>, input: string) =>
    spawnSync(process.execPath, [script, "PreToolUse"], { input, env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8", timeout: 5000 });

  it("does nothing, exits 0 and prints nothing when not in a kyle-term session", () => {
    const r = run({}, "{}");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
  it("exits 0 quietly when the server is unreachable", () => {
    const r = run({ KYLE_TERM_SESSION: "s", KYLE_TERM_PORT: "1", KYLE_TERM_TOKEN: "t" }, "{}");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
  it("exits 0 on garbage stdin", () => {
    expect(run({ KYLE_TERM_SESSION: "s", KYLE_TERM_PORT: "1" }, "%%%").status).toBe(0);
  });
  it("posts { session, event, payload } with the token", async () => {
    const got: HookMessage[] = [];
    server = new HookServer((m) => got.push(m));
    const port = await server.start();
    const payload = { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "x".repeat(2000) } };
    const r = await new Promise<{ status: number | null; stdout: string }>((resolve) => {
      const child = require("node:child_process").spawn(process.execPath, [script, "PreToolUse"], {
        env: { PATH: process.env.PATH ?? "", KYLE_TERM_SESSION: "sess", KYLE_TERM_PORT: String(port), KYLE_TERM_TOKEN: server!.token },
      });
      let stdout = "";
      child.stdout.on("data", (c: Buffer) => { stdout += c; });
      child.on("exit", (status: number | null) => resolve({ status, stdout }));
      child.stdin.end(JSON.stringify(payload));
    });
    expect(r).toEqual({ status: 0, stdout: "" });
    expect(got).toHaveLength(1);
    expect(got[0]!.session).toBe("sess");
    expect(got[0]!.event).toBe("PreToolUse");
    expect((got[0]!.payload.tool_input as { command: string }).command.length).toBe(500);
  });
  it("forwards KH_* env vars (and nothing else) alongside the payload", async () => {
    const got: HookMessage[] = [];
    server = new HookServer((m) => got.push(m));
    const port = await server.start();
    await new Promise<void>((resolve) => {
      const child = require("node:child_process").spawn(process.execPath, [script, "Stop"], {
        env: { PATH: process.env.PATH ?? "", SECRET: "no", KH_TICKET: "KH-7", KH_RUN: "r1", KYLE_TERM_SESSION: "sess", KYLE_TERM_PORT: String(port), KYLE_TERM_TOKEN: server!.token },
      });
      child.on("exit", () => resolve());
      child.stdin.end("{}");
    });
    expect(got[0]!.env).toEqual({ KH_TICKET: "KH-7", KH_RUN: "r1" });
  });

  /** Runs the hook with loopback pointed at a dead port and KYLE_TERM_WSL_HOST at the live server. */
  const viaWslHost = async (extraEnv: Record<string, string>): Promise<HookMessage[]> => {
    const got: HookMessage[] = [];
    server = new HookServer((m) => got.push(m));
    const port = await server.start();
    const dead = await new Promise<number>((resolve) => {
      const s = http.createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
    });
    await new Promise<void>((resolve) => {
      const child = require("node:child_process").spawn(process.execPath, [script, "Stop"], {
        env: { PATH: process.env.PATH ?? "", KYLE_TERM_SESSION: "wsl", KYLE_TERM_PORT: String(dead), KYLE_TERM_TOKEN: server!.token, KYLE_TERM_WSL_HOST: `127.0.0.1:${port}`, ...extraEnv },
      });
      child.on("exit", () => resolve());
      child.stdin.end("{}");
    });
    return got;
  };
  it("inside WSL, falls back to KYLE_TERM_WSL_HOST when loopback is unreachable", async () => {
    const got = await viaWslHost({ WSL_DISTRO_NAME: "Ubuntu" });
    expect(got.map((m) => m.session)).toEqual(["wsl"]);
  });
  it("outside WSL, ignores KYLE_TERM_WSL_HOST", async () => {
    expect(await viaWslHost({})).toEqual([]);
  });
});
