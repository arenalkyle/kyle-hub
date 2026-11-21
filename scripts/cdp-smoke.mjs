// CDP smoke: opens a terminal through the term module's SessionService in a running Obsidian and reads its prompt.
//
// Start Obsidian with the debug port (vault with kyle-hub enabled, kyle-term disabled):
//   "%LOCALAPPDATA%\Programs\Obsidian\Obsidian.exe" --remote-debugging-port=9222
// then: npm run smoke   (CDP_PORT=9333 npm run smoke for another port)
//
// Exit 0 when the shell printed a prompt, 1 otherwise. Closes the session it opened.
const PORT = Number(process.env.CDP_PORT ?? 9222);
const WAIT_MS = Number(process.env.SMOKE_WAIT_MS ?? 4000);
const PROMPT = /PS [A-Za-z]:\\.*>|[A-Za-z]:\\.*>|\$ $/m;

const EXPR = `(async () => {
  const plugin = app.plugins.plugins["kyle-hub"];
  if (!plugin) throw new Error("kyle-hub is not enabled");
  const svc = plugin.hub.services.get("sessions");
  if (!svc) throw new Error("term module is off: no SessionService");
  const s = svc.spawn({ title: "cdp-smoke" });
  await new Promise((r) => setTimeout(r, ${WAIT_MS}));
  const text = svc.tail(s.id, 20);
  const state = svc.get(s.id)?.state;
  svc.close(s.id);
  return { text, state };
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
      if (m.error || m.result?.exceptionDetails) {
        reject(new Error(m.error?.message ?? m.result.exceptionDetails.exception?.description ?? "evaluate failed"));
      } else resolve(m.result.result.value);
    };
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: EXPR, awaitPromise: true, returnByValue: true } }));
  });
  ws.close();
  const ok = PROMPT.test(result.text);
  console.log(ok ? "smoke: PASS" : "smoke: FAIL (no prompt in terminal output)");
  console.log(`state=${result.state}\n${result.text.trim().split("\n").slice(-5).join("\n")}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(`smoke: FAIL (${e.message})`);
  process.exit(1);
});
