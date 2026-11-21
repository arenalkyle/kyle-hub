// CDP smoke for the usage tracker (LOCK-60): checks the usage service, the status-bar chip and the dashboard usage tile,
// and that the per-account line the launch picker shows is available. Read-only: writes nothing.
// Requires the usage and commandCenter modules enabled, at least one account, and Obsidian started with a debug port:
//   Obsidian.exe --remote-debugging-port=9222   then   node scripts/cdp-usage-smoke.mjs
// Exit 0 on pass, 1 on failure.
const PORT = Number(process.env.CDP_PORT ?? 9222);

const EXPR = `(async () => {
  const plugin = app.plugins.plugins["kyle-hub"];
  if (!plugin) throw new Error("kyle-hub is not enabled");
  const usage = plugin.hub.services.get("usage");
  if (!usage) throw new Error("usage module is not loaded");
  const snap = await usage.snapshot();
  const lines = await usage.lines();
  const chip = document.querySelector(".kh-usage-chip");
  await app.commands.executeCommandById("kyle-hub:command-center-open");
  await new Promise((r) => setTimeout(r, 1500));
  const tile = document.querySelector(".kh-usage-tile");
  const rows = tile ? tile.querySelectorAll(".kh-usage-row").length : 0;
  const bars = tile ? tile.querySelectorAll(".kh-usage-bar").length : 0;
  const out = {
    accounts: snap.length,
    pickerLines: Object.keys(lines).length,
    chipText: chip ? chip.textContent : null,
    tileRows: rows,
    tileBars: bars,
  };
  out.ok = snap.length > 0 && out.pickerLines === snap.length && Boolean(out.chipText) && rows === snap.length;
  for (const l of app.workspace.getLeavesOfType("kh-command-center-view")) l.detach();
  return out;
})()`;

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = targets.find((t) => t.type === "page" && String(t.url).startsWith("app://obsidian.md"));
  if (!page) throw new Error("no Obsidian page found on the debug port");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error("websocket failed"));
  });
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
    console.error("FAIL: usage chip, picker lines or dashboard tile missing");
    process.exitCode = 1;
  } else console.log("PASS");
}

main().catch((e) => {
  console.error(String(e.message ?? e));
  process.exitCode = 1;
});
