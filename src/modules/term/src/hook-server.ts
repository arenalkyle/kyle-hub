import http from "node:http";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";

export interface HookMessage { session: string; event: string; payload: Record<string, unknown> }

const MAX_BODY = 1_000_000;

/** Loopback-only HTTP server receiving hook events from hooks/kyle-hook.js (ADR-0002). */
export class HookServer {
  readonly token = crypto.randomBytes(24).toString("hex");
  port = 0;
  private server: http.Server | null = null;

  constructor(private onMessage: (m: HookMessage) => void) {}

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.handle(req, res));
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        this.server = server;
        this.port = (server.address() as AddressInfo).port;
        resolve(this.port);
      });
    });
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const end = (code: number): void => { res.statusCode = code; res.end(); };
    if (req.headers["x-kyle-token"] !== this.token) return end(401);
    if (req.method !== "POST" || req.url !== "/event") return end(404);
    let body = "";
    let tooBig = false;
    req.setEncoding("utf8");
    req.on("data", (c: string) => {
      body += c;
      if (body.length > MAX_BODY) { tooBig = true; req.destroy(); }
    });
    req.on("end", () => {
      if (tooBig) return;
      try {
        const m = JSON.parse(body) as Partial<HookMessage>;
        if (typeof m.session !== "string" || typeof m.event !== "string") return end(400);
        this.onMessage({ session: m.session, event: m.event, payload: (m.payload ?? {}) as Record<string, unknown> });
        end(204);
      } catch {
        end(400);
      }
    });
    req.on("error", () => {});
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }
}
