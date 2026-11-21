// CDP smoke for session end (LOCK-52): like cdp-launch-smoke, makes a fixture git repo and one agent-ready
// ticket, launches it from the Queue, but the "Claude" command is the plugin's own hook script sending a
// SessionEnd event (no real Claude session runs). Checks that the end-of-run handler posted the mechanical
// summary as kyle-hub, left the ticket In Progress, set outcome, raised needs-attention, and that the Queue
// row shows the badge. Then closes the session and removes the worktree, repo and ticket.
//
// Run against a THROWAWAY vault with kyle-hub (tickets + term, hooks not required) enabled:
//   Obsidian.exe --remote-debugging-port=9222   then   node scripts/cdp-session-end-smoke.mjs
// Exit 0 on pass, 1 on failure.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.CDP_PORT ?? 9222);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "kh-smoke-"));
const repo = path.join(root, "repo");
fs.mkdirSync(repo);
const git = (...a) => execFileSync("git", ["-c", "user.name=smoke", "-c", "user.email=s@s", ...a], { cwd: repo, stdio: "ignore" });
git("init", "-b", "main");
fs.writeFileSync(path.join(repo, "README.md"), "fixture\n");
git("add", ".");
git("commit", "-m", "init");

const EXPR = `(async () => {
  const plugin = app.plugins.plugins["kyle-hub"];
  if (!plugin) throw new Error("kyle-hub is not enabled");
  const tickets = plugin.hub.services.get("tickets");
  const sessions = plugin.hub.services.get("sessions");
  if (!tickets || !sessions) throw new Error("tickets and term modules must both be on");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const core = plugin.hub.settings.module("core");
  const prevRepos = core.repos;
  core.repos = { smoke: { path: ${JSON.stringify(repo)}, profile: "home", worktrees: true } };
  const base = app.vault.adapter.getBasePath().replace(/\\\\/g, "/");
  plugin.hub.settings.module("term").claudeCommand = 'node "' + base + '/' + app.vault.configDir + '/plugins/kyle-hub/hooks/kyle-hook.js" SessionEnd';
  const made = await tickets.create({ title: "session end smoke " + Date.now(), tags: ["agent-ready"], repo: "smoke", status: tickets.statuses().find((s) => s.category === "unstarted").name });
  const out = {};
  let sid;
  try {
    await app.commands.executeCommandById("kyle-hub:term-open-queue");
    await sleep(700);
    const row = document.querySelector('[data-kh-queue-id="' + made.id + '"]');
    if (!row) throw new Error("fixture ticket is not in the Queue");
    row.querySelector(".kh-term-queue-launch").click();
    await sleep(7000);
    const t = tickets.get(made.id);
    sid = sessions.list().find((s) => /\.kh-worktrees/.test(s.cwd) && s.cwd.endsWith(made.id))?.id;
    const mech = t.feed.find((f) => f.type === "comment" && f.author === "kyle-hub");
    const attn = plugin.hub.services.get("attention")?.get(made.id);
    out.status = t.status;
    out.outcome = t.outcome;
    out.comment = mech ? mech.body.split("
")[0] : null;
    out.attention = attn ? attn.reason : null;
    out.badge = !!document.querySelector('[data-kh-queue-id="' + made.id + '"] .kh-term-attention');
    out.ok = !!mech && t.status === "In Progress" && !!t.outcome && attn?.reason === "no agent summary" && out.badge;
    out.id = made.id;
    return out;
  } finally {
    if (sid) sessions.close(sid);
    core.repos = prevRepos;
    const f = app.vault.getMarkdownFiles().find((x) => x.basename === made.id);
    if (f) await app.fileManager.trashFile(f);
  }
})()`;

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = targets.find((t) => t.type === "page" && String(t.url).startsWith("app://obsidian.md"));
  if (!page) throw new Error("no Obsidian page found on the debug port");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("websocket failed")); });
  const result = await new Promise((resolve, reject) => {
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id !== 1) return;
      if (m.error || m.result?.exceptionDetails) reject(new Error(m.error?.message ?? m.result.exceptionDetails.exception?.description ?? "evaluate failed"));
      else resolve(m.result.result.value);
    };
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: EXPR, awaitPromise: true, returnByValue: true } }));
  });
  ws.close();
  const wt = path.join(root, ".kh-worktrees", "smoke", result.id ?? "");
  result.worktreeExists = result.id ? fs.existsSync(path.join(wt, "README.md")) : false;
  console.log(JSON.stringify(result));
  if (!result.ok || !result.worktreeExists) {
    console.error("FAIL: session end did not post the mechanical summary and raise needs-attention");
    process.exitCode = 1;
  } else console.log("PASS");
}

main()
  .catch((e) => {
    console.error(String(e.message ?? e));
    process.exitCode = 1;
  })
  .finally(() => {
    // The shell may still hold the worktree for a moment; best effort.
    setTimeout(() => {
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* temp dir; leave it */ }
    }, 1500);
  });
