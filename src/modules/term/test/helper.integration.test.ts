import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { encode, LineDecoder, type FromHelper } from "../src/protocol";

const root = path.resolve(__dirname, "..");
const helper = path.join(root, "helper", "pty-host.js");
const probe = spawnSync("node", ["-e", "require('@lydell/node-pty')"], { cwd: root, windowsHide: true });
const available = probe.status === 0;
const isWin = process.platform === "win32";

describe.skipIf(!available)("pty helper (integration)", () => {
  it("spawns a shell and echoes output", async () => {
    const child = spawn("node", [helper], { cwd: root, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const dec = new LineDecoder<FromHelper>();
    let out = "";
    let exited = false;
    child.on("exit", () => (exited = true));
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout; output so far: ${JSON.stringify(out)}`)), 15000);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (c: string) => {
        for (const m of dec.push(c)) {
          if (m.t === "ready") {
            child.stdin.write(
              encode({
                t: "spawn", id: "t1",
                shell: isWin ? "powershell.exe" : "/bin/sh",
                args: isWin ? ["-NoLogo", "-NoProfile"] : [],
                cwd: root, cols: 100, rows: 30, env: process.env as Record<string, string>,
              }),
            );
            setTimeout(() => child.stdin.write(encode({ t: "write", id: "t1", data: "echo kyle-term-ok\r" })), 1500);
          } else if (m.t === "data") {
            out += m.data;
            if (m.data.includes("\x1b[c")) child.stdin.write(encode({ t: "write", id: "t1", data: "\x1b[?1;2c" }));
            // the typed command is echoed too; wait for the command output as well
            if ((out.match(/kyle-term-ok/g) ?? []).length >= 2) { clearTimeout(timer); resolve(); }
          } else if (m.t === "error") {
            clearTimeout(timer); reject(new Error(m.message));
          }
        }
      });
    });
    try {
      await done;
      expect(out).toContain("kyle-term-ok");
    } finally {
      child.stdin.end(); // helper must exit when stdin closes
      await new Promise((r) => setTimeout(r, 1500));
      const wasExited = exited;
      if (!exited) child.kill();
      expect(wasExited).toBe(true);
    }
  });

  // Windows 10's in-box ConPTY swallows this switch, so xterm reflowed Claude's full-screen UI into duplicate banners.
  it.runIf(isWin)("passes the alternate-screen switch through", async () => {
    const child = spawn("node", [helper], { cwd: root, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const closed = new Promise((resolve) => child.once("exit", resolve));
    const dec = new LineDecoder<FromHelper>();
    let out = "";
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timeout waiting for the child to exit")), 15000);
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (c: string) => {
          for (const m of dec.push(c)) {
            if (m.t === "ready") {
              child.stdin.write(encode({
                t: "spawn", id: "alt", shell: process.execPath,
                args: ["-e", "process.stdout.write(String.fromCharCode(27)+'[?1049h');setTimeout(()=>{},500)"],
                cwd: root, cols: 100, rows: 30, env: process.env as Record<string, string>,
              }));
            } else if (m.t === "data") {
              out += m.data;
              // ConPTY waits for the terminal's device-attributes answer.
              if (m.data.includes("\x1b[c")) child.stdin.write(encode({ t: "write", id: "alt", data: "\x1b[?1;2c" }));
            } else if (m.t === "exit") {
              clearTimeout(timer); resolve();
            } else if (m.t === "error") {
              clearTimeout(timer); reject(new Error(m.message));
            }
          }
        });
      });
      expect(out).toContain("\x1b[?1049h");
    } finally {
      child.stdin.end();
      await closed;
    }
  }, 20000);
});
