// CDP smoke for Perform Retro (LOCK-54): swaps the hub's LogService for fixture logs, opens the Terminal view,
// clicks Perform Retro, and checks that proposal/finding tickets land in Triage (source agent:retro, <= 5) and that
// the "Last retro" text updates. Restores the real log service and trashes the created tickets afterwards.
// It does write `retro.json` (watermark) under %LOCALAPPDATA%\kyle-hub\home, so run it against a THROWAWAY vault/profile:
//   Obsidian.exe --remote-debugging-port=9222   then   node scripts/cdp-retro-smoke.mjs
// Exit 0 on pass, 1 on failure.
const PORT = Number(process.env.CDP_PORT ?? 9222);

const EXPR = `(async () => {
  const plugin = app.plugins.plugins["kyle-hub"];
  if (!plugin) throw new Error("kyle-hub is not enabled");
  const tickets = plugin.hub.services.get("tickets");
  if (!tickets || !plugin.hub.services.get("retro")) throw new Error("tickets and term modules must both be on");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const stamp = Date.now();
  const runs = [];
  const records = {};
  for (let i = 0; i < 4; i++) {
    const t = new Date(Date.now() - (10 - i) * 60000).toISOString();
    const id = "r-smoke" + stamp + "-" + i;
    runs.push({ runId: id, sessionId: "s-smoke" + i, profile: "home", start: t, durationMs: 1, costUsd: 0, toolCalls: 1, errors: 1, denials: 1 });
    records[id] = [
      { type: "permission_denied", t, tool: "Bash", pattern: "smoketool" + stamp + " <path>" },
      { type: "error", t, tool: "Bash", sigText: "smoke error " + stamp },
    ];
  }
  const fake = {
    runs: async () => runs,
    run: async (id) => runs.find((r) => r.runId === id),
    records: async function* (id) { for (const r of records[id] ?? []) yield r; },
  };
  const real = plugin.hub.services.get("logs");
  plugin.hub.services.register("logs", fake);
  const before = new Set(tickets.list().map((i) => i.id));
  const out = {};
  try {
    await app.commands.executeCommandById("kyle-hub:term-open");
    await sleep(800);
    const btn = document.querySelector('[data-kh-retro="perform"]');
    if (!btn) throw new Error("Perform Retro button not found");
    const lastEl = document.querySelector('[data-kh-retro="last"]');
    out.lastBefore = lastEl?.textContent;
    out.sinceBefore = document.querySelector('[data-kh-retro="since"]')?.textContent;
    btn.click();
    await sleep(2500);
    const made = tickets.list().filter((i) => !before.has(i.id));
    out.created = made.map((i) => i.type + ":" + i.title);
    out.sources = [...new Set(made.map((i) => i.source))];
    out.triage = made.every((i) => tickets.statuses().find((s) => s.name === i.status)?.category === "triage");
    out.lastAfter = lastEl?.textContent;
    out.sinceAfter = document.querySelector('[data-kh-retro="since"]')?.textContent;
    out.ok = made.length >= 1 && made.length <= 5 && out.triage && out.sources.length === 1 && out.sources[0] === "agent:retro" &&
      /just now/.test(out.lastAfter ?? "") && /^0 sessions/.test(out.sinceAfter ?? "");
    for (const i of made) {
      const f = app.vault.getMarkdownFiles().find((x) => x.basename === i.id);
      if (f) await app.fileManager.trashFile(f);
    }
    return out;
  } finally {
    if (real) plugin.hub.services.register("logs", real);
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
  console.log(JSON.stringify(result));
  if (!result.ok) {
    console.error("FAIL: Perform Retro did not create Triage tickets / update the watermark text");
    process.exitCode = 1;
  } else console.log("PASS");
}

main().catch((e) => {
  console.error(String(e.message ?? e));
  process.exitCode = 1;
});
