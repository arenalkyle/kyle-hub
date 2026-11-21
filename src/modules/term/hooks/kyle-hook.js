#!/usr/bin/env node
// kyle-hub terminal hook: forwards a Claude Code hook event to the plugin's local server.
// Must never block or fail Claude Code (ADR-0002): no stdout, always exit 0, short timeouts.
"use strict";
const session = process.env.KYLE_TERM_SESSION;
if (!session) process.exit(0);

const done = () => process.exit(0);
setTimeout(done, 1500); // hard cap on total runtime

function shrink(v, depth) {
  if (typeof v === "string") return v.length > 500 ? v.slice(0, 500) : v;
  if (v === null || typeof v !== "object") return v;
  if (depth > 3) return undefined;
  const out = Array.isArray(v) ? [] : {};
  for (const k of Object.keys(v)) out[k] = shrink(v[k], depth + 1);
  return out;
}

function send(payload) {
  try {
    const port = Number(process.env.KYLE_TERM_PORT);
    if (!port) return done();
    const event = process.argv[2] || (payload && payload.hook_event_name) || "";
    // KH_* env vars (e.g. KH_TICKET, KH_RUN set by the launcher) ride along; harmless when absent.
    const env = {};
    for (const k of Object.keys(process.env)) if (k.startsWith("KH_")) env[k] = String(process.env[k]).slice(0, 500);
    const body = JSON.stringify({ session, event, payload: shrink(payload || {}, 0), ...(Object.keys(env).length ? { env } : {}) });
    const req = require("node:http").request(
      {
        host: "127.0.0.1", port, path: "/event", method: "POST", timeout: 500,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "x-kyle-token": process.env.KYLE_TERM_TOKEN || "",
        },
      },
      (res) => { res.resume(); res.on("end", done); res.on("error", done); },
    );
    req.on("error", done);
    req.on("timeout", () => { req.destroy(); done(); });
    req.end(body);
  } catch {
    done();
  }
}

try {
  let raw = "";
  let sent = false;
  const fire = () => {
    if (sent) return;
    sent = true;
    let payload = {};
    try { payload = JSON.parse(raw); } catch { /* send empty payload */ }
    send(payload);
  };
  if (process.stdin.isTTY) fire();
  else {
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { raw += c; });
    process.stdin.on("end", fire);
    process.stdin.on("error", fire);
    setTimeout(fire, 400); // don't wait on a stdin that never closes
  }
} catch {
  done();
}
