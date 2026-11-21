// CDP smoke for the command center (LOCK-57): runs the "Open command center" command, checks that the view renders
// seven tiles and the sparkline container, then closes the leaf. Read-only: writes nothing to the vault or log folders.
// Requires the commandCenter module enabled (settings tab) and Obsidian started with a debug port:
//   Obsidian.exe --remote-debugging-port=9222   then   node scripts/cdp-command-center-smoke.mjs
// Exit 0 on pass, 1 on failure.
const PORT = Number(process.env.CDP_PORT ?? 9222);

const EXPR = `(async () => {
  const plugin = app.plugins.plugins["kyle-hub"];
  if (!plugin) throw new Error("kyle-hub is not enabled");
  if (!app.commands.commands["kyle-hub:command-center-open"]) throw new Error("Command center module is not loaded (enable it in kyle-hub settings and reload)");
  await app.commands.executeCommandById("kyle-hub:command-center-open");
  await new Promise((r) => setTimeout(r, 1500));
  const leaves = app.workspace.getLeavesOfType("kh-command-center-view");
  const root = document.querySelector(".kh-command-center");
  const tiles = root ? root.querySelectorAll(".kh-command-center-tile").length : 0;
  const out = { leaves: leaves.length, tiles, sparkline: Boolean(root?.querySelector(".kh-command-center-sparkline, .kh-command-center-spend")) };
  out.ok = leaves.length >= 1 && tiles === 7 && out.sparkline;
  for (const l of leaves) l.detach();
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
    console.error("FAIL: command center view did not open with 7 tiles and the spend sparkline");
    process.exitCode = 1;
  } else console.log("PASS");
}

main().catch((e) => {
  console.error(String(e.message ?? e));
  process.exitCode = 1;
});
