"use strict";
// PTY host: runs on system Node, owns @lydell/node-pty. Newline-delimited JSON over stdio (ADR-0001).
const readline = require("node:readline");

let pty;
try {
  pty = require("@lydell/node-pty");
} catch (e) {
  process.stdout.write(JSON.stringify({ t: "error", message: `cannot load @lydell/node-pty: ${e.message}` }) + "\n");
  process.exit(1);
}

// macOS: node-pty spawns shells through `spawn-helper`, which loses its execute bit when copied or synced on Windows.
if (process.platform !== "win32") {
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const dir = path.dirname(require.resolve(`@lydell/node-pty-${process.platform}-${process.arch}/package.json`));
    for (const sub of ["", "prebuilds", path.join("prebuilds", `${process.platform}-${process.arch}`)]) {
      const helper = path.join(dir, sub, "spawn-helper");
      if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
    }
  } catch { /* best effort */ }
}

const sessions = new Map();
const out = (m) => process.stdout.write(JSON.stringify(m) + "\n");

function killAll() {
  for (const p of sessions.values()) {
    try { p.kill(); } catch { /* ignore */ }
  }
  sessions.clear();
}

function handle(m) {
  try {
    switch (m.t) {
      case "spawn": {
        const p = pty.spawn(m.shell, m.args || [], {
          name: "xterm-256color",
          cols: m.cols || 80,
          rows: m.rows || 24,
          cwd: m.cwd,
          env: m.env || process.env,
          // Windows 10's in-box ConPTY hides the alternate screen and repaints on resize, duplicating TUIs (term ADR-0003).
          useConptyDll: true,
        });
        sessions.set(m.id, p);
        p.onData((data) => out({ t: "data", id: m.id, data }));
        p.onExit(({ exitCode, signal }) => {
          sessions.delete(m.id);
          out({ t: "exit", id: m.id, code: exitCode, signal });
        });
        break;
      }
      case "write": sessions.get(m.id)?.write(m.data); break;
      case "resize": sessions.get(m.id)?.resize(Math.max(1, m.cols), Math.max(1, m.rows)); break;
      case "kill": sessions.get(m.id)?.kill(); break;
    }
  } catch (e) {
    out({ t: "error", id: m.id, message: String((e && e.message) || e) });
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let m;
  try { m = JSON.parse(line); } catch { return; }
  handle(m);
});
// Die with Obsidian: stdin closes -> kill shells and exit.
rl.on("close", () => { killAll(); process.exit(0); });
process.on("SIGTERM", () => { killAll(); process.exit(0); });
process.on("exit", killAll);

out({ t: "ready" });
