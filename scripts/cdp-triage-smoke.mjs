// CDP smoke for the Triage view (LOCK-48): creates 3 agent tickets through TicketService, opens Triage,
// presses a / r / d (+ reason, Enter), checks statuses, label and decline comment, then deletes the fixtures.
//
// Run against a THROWAWAY vault with kyle-hub enabled and tickets set up (it writes 3 tickets and removes them):
//   Obsidian.exe --remote-debugging-port=9222   then   node scripts/cdp-triage-smoke.mjs
// Exit 0 on pass, 1 on failure.
const PORT = Number(process.env.CDP_PORT ?? 9222);

const EXPR = `(async () => {
  const hub = app.plugins.plugins["kyle-hub"];
  if (!hub) throw new Error("kyle-hub is not enabled");
  const svc = hub.hub.services.get("tickets");
  if (!svc) throw new Error("tickets module is off");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mk = (t) => svc.create({ title: t, tags: [] }, { agent: true, author: "cdp-smoke" });
  const stamp = Date.now();
  const made = [await mk("smoke A " + stamp), await mk("smoke B " + stamp), await mk("smoke C " + stamp)];
  const ids = made.map((i) => i.id);
  try {
    await app.commands.executeCommandById("kyle-hub:open");
    await sleep(500);
    const nav = [...document.querySelectorAll(".kh-tickets-nav-item")].find((b) => b.textContent.trim() === "Triage");
    if (!nav) throw new Error("no Triage entry in the sidebar");
    nav.click();
    await sleep(500);
    const root = document.querySelector(".kh-tickets-triage");
    if (!root) throw new Error("Triage view did not render");
    const shown = ids.filter((id) => root.querySelector('[data-kh-tickets-id="' + id + '"]'));
    if (shown.length !== 3) throw new Error("expected 3 tickets in Triage, saw " + shown.length);
    if (root.querySelectorAll("[data-kh-tickets-type]").length < 3) throw new Error("type chips missing");
    const press = async (key) => { root.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); await sleep(400); };
    // Newest first: C, B, A. Selection starts on the first row and advances after each action.
    const order = [...root.querySelectorAll("[data-kh-tickets-id]")].map((e) => e.dataset.khTicketsId);
    await press("a");
    await press("r");
    await press("d");
    const input = root.querySelector(".kh-tickets-triage-decline input");
    if (!input) throw new Error("decline prompt did not open");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, "smoke reason");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await sleep(800);
    const [first, second, third] = order.map((id) => svc.get(id));
    const out = {
      accepted: first.status + "|" + first.tags.join(","),
      ready: second.status + "|" + second.tags.join(","),
      declined: third.status + "|" + third.feed.filter((f) => f.type === "comment").map((f) => f.body).join(","),
    };
    const ok = first.status === "Backlog" && !first.tags.includes("agent-ready")
      && second.status === "Backlog" && second.tags.includes("agent-ready")
      && third.status === "Canceled" && out.declined.endsWith("Declined: smoke reason");
    return { ok, out };
  } finally {
    const store = hub.hub.services.get("tickets");
    for (const id of ids) {
      const path = app.vault.getMarkdownFiles().find((f) => f.basename === id);
      if (path) await app.fileManager.trashFile(path);
    }
    void store;
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
  console.log(JSON.stringify(result.out));
  if (!result.ok) {
    console.error("FAIL: triage keys did not produce the expected statuses");
    process.exit(1);
  }
  console.log("PASS");
}

main().catch((e) => {
  console.error(String(e.message ?? e));
  process.exit(1);
});
