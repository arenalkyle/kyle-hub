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

// Targets in order: loopback (native Windows, macOS, WSL2 mirrored networking), then the Windows host's WSL adapter
// address the plugin passes as KYLE_TERM_WSL_HOST ("ip:port"), used only inside WSL where 127.0.0.1 is the Linux VM.
function targets(port) {
  const list = [{ host: "127.0.0.1", port }];
  const wsl = process.env.KYLE_TERM_WSL_HOST;
  if (wsl && process.env.WSL_DISTRO_NAME) {
    const i = wsl.lastIndexOf(":");
    const p = Number(wsl.slice(i + 1));
    if (i > 0 && p) list.push({ host: wsl.slice(0, i), port: p });
  }
  return list;
}

function post(target, body, onFail) {
  let failed = false;
  const fail = () => { if (!failed) { failed = true; onFail(); } };
  const req = require("node:http").request(
    {
      host: target.host, port: target.port, path: "/event", method: "POST", timeout: 500,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
        "x-kyle-token": process.env.KYLE_TERM_TOKEN || "",
      },
    },
    (res) => { res.resume(); res.on("end", done); res.on("error", done); },
  );
  req.on("error", fail);
  req.on("timeout", () => { req.destroy(); fail(); });
  req.end(body);
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
    const list = targets(port);
    const next = (i) => (i < list.length ? post(list[i], body, () => next(i + 1)) : done());
    next(0);
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
