// CDP smoke for the launch queue (LOCK-51): makes a fixture git repo in the OS temp dir, maps it in memory
// (not saved), creates one agent-ready fixture ticket, opens the Queue view, clicks Launch and checks the
// worktree, the session, and the ticket (In Progress + run id). Then closes the session, removes the worktree,
// the repo and the ticket.
//
// Run against a THROWAWAY vault with kyle-hub (tickets + term) enabled; it writes and removes one ticket and
// spawns a real shell session running `claude` in the worktree (use KH_SMOKE_CLAUDE=echo to type `echo` instead):
//   Obsidian.exe --remote-debugging-port=9222   then   node scripts/cdp-launch-smoke.mjs
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
const claude = process.env.KH_SMOKE_CLAUDE ?? "";

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
  ${claude ? `plugin.hub.settings.module("term").claudeCommand = ${JSON.stringify(claude)};` : ""}
  const made = await tickets.create({ title: "launch smoke " + Date.now(), tags: ["agent-ready"], repo: "smoke", status: tickets.statuses().find((s) => s.category === "unstarted").name });
  const out = {};
  let sid;
  try {
    await app.commands.executeCommandById("kyle-hub:term-open-queue");
    await sleep(700);
    const row = document.querySelector('[data-kh-queue-id="' + made.id + '"]');
    if (!row) throw new Error("fixture ticket is not in the Queue");
    row.querySelector(".kh-term-queue-launch").click();
    await sleep(3000);
    const t = tickets.get(made.id);
    sid = sessions.list().find((s) => /\\.kh-worktrees/.test(s.cwd) && s.cwd.endsWith(made.id))?.id;
    out.status = t.status;
    out.runs = t.runs;
    out.cwd = sid ? sessions.get(sid).cwd : null;
    out.queueShowsRunning = !!document.querySelector('[data-kh-queue-id="' + made.id + '"] .kh-term-queue-running');
    out.ok = !!sid && t.runs?.length === 1 && /^r-\\d{8}-\\d{6}-/.test(t.runs[0]) && t.status !== "Todo" && out.queueShowsRunning;
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
    console.error("FAIL: launch did not produce a worktree, session and In Progress ticket");
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
