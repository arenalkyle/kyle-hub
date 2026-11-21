// CDP smoke for the Promote modal (LOCK-58): opens the modal on an in-memory sample lesson through the `promote` service,
// checks the scrubbed before/after diff and the Cancel/Promote buttons, then cancels. Writes nothing: the vault profile is
// switched to work in memory only (never saved) and restored, and the modal is cancelled, never confirmed.
// Requires the brain module enabled and Obsidian started with a debug port:
//   Obsidian.exe --remote-debugging-port=9222   then   node scripts/cdp-promote-smoke.mjs
// Exit 0 on pass, 1 on failure.
const PORT = Number(process.env.CDP_PORT ?? 9222);

const EXPR = `(async () => {
  const plugin = app.plugins.plugins["kyle-hub"];
  if (!plugin) throw new Error("kyle-hub is not enabled");
  const svc = plugin.hub.services.get("promote");
  if (!svc) throw new Error("Brain module is not loaded (enable it in kyle-hub settings and reload)");
  const core = plugin.hub.settings.module("core");
  const prevProfile = core.profile;
  const repoKey = Object.keys(core.repos ?? {})[0] ?? "sample-repo";
  core.profile = "work";
  const sample = "---\\ntype: lesson\\n---\\nEdit C:/Work/" + repoKey + "/a.ts, see https://wiki.corp.local/x and mail a@b.io, repo " + repoKey + ".\\n";
  let refusal;
  try {
    refusal = svc.open("Smoke Lesson.md", sample);
    await new Promise((r) => setTimeout(r, 500));
    const modal = document.querySelector(".kh-brain-promote");
    const diff = modal ? modal.querySelector(".kh-brain-promote-diff")?.textContent ?? "" : "";
    const out = {
      refusal: refusal ?? null,
      modal: Boolean(modal),
      hasPath: diff.includes("<path>"),
      hasUrl: diff.includes("<url>"),
      hasEmail: diff.includes("<email>"),
      hasRepo: Object.keys(core.repos ?? {}).length === 0 || diff.includes("<repo>"),
      leaked: diff.split("\\n").filter((l) => l.startsWith("+") && /C:\\/Work|corp\\.local|a@b\\.io/.test(l)).length,
      buttons: modal ? [...modal.querySelectorAll("button")].map((b) => b.textContent) : [],
    };
    out.ok = !refusal && out.modal && out.hasPath && out.hasUrl && out.hasEmail && out.hasRepo && out.leaked === 0 && out.buttons.includes("Cancel") && out.buttons.includes("Promote");
    [...(modal?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Cancel")?.click();
    await new Promise((r) => setTimeout(r, 200));
    out.closed = !document.querySelector(".kh-brain-promote");
    out.ok = out.ok && out.closed;
    return out;
  } finally {
    core.profile = prevProfile;
  }
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
    console.error("FAIL: Promote modal did not render the scrubbed diff with Cancel/Promote");
    process.exitCode = 1;
  } else console.log("PASS");
}

main().catch((e) => {
  console.error(String(e.message ?? e));
  process.exitCode = 1;
});
