// CDP smoke for Command Center v2 (LOCK-61, PHASES 10-16). Read-only: runs "Open command center", checks the layout,
// then opens the Brain tab (kh-brain-view) on a new leaf, checks its 3D host and Gaps panel, and detaches both leaves.
// Writes nothing to the vault or log folders.
// Checks: opened, tiles, columns, vitals, brain3d (full-view backdrop), spendTop, retro (left column), brainTab.
// Requires the commandCenter module enabled (settings tab) and Obsidian started with a debug port:
//   Obsidian.exe --remote-debugging-port=9222   then   node scripts/cdp-command-center-smoke.mjs
// Env: CDP_PORT (default 9222). Prints the result JSON, then PASS, or lists the failed checks and exits 1.
const PORT = Number(process.env.CDP_PORT ?? 9222);

// model.buildCommandCenterModel() yields 7 tiles (triage, queue, running, needs-attention, spend, brain, retro).
// view.ts paints only the work-state tiles (triage, running, needs-attention, queue) as .kh-command-center-tile;
// spend renders as the centre sparkline card, brain as Brain Vitals and retro as the Retro card. So the DOM holds 4
// tiles whatever the module state, because each of those four always gets a tile, even when degraded.
const EXPECTED_TILES = 4;
const COMMAND_CENTER_VIEW_TYPE = "kh-command-center-view";
const BRAIN_VIEW_TYPE = "kh-brain-view"; // brain/view.ts
const VITALS_LABELS = ["Notes read", "Writes (1 h)", "Searches (1 h)", "Active agents"];
const GAPS_NO_DATA = "No gaps data yet";

const EXPR = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const plugin = app.plugins.plugins["kyle-hub"];
  if (!plugin) throw new Error("kyle-hub is not enabled");
  if (!app.commands.commands["kyle-hub:command-center-open"]) throw new Error("Command center module is not loaded (enable it in kyle-hub settings and reload)");
  await app.commands.executeCommandById("kyle-hub:command-center-open");
  await sleep(1500);
  const ccLeaves = app.workspace.getLeavesOfType("${COMMAND_CENTER_VIEW_TYPE}");
  const ccEl = ccLeaves[0]?.view.contentEl ?? null; // view.ts puts .kh-command-center on contentEl itself
  const root = ccEl?.matches(".kh-command-center") ? ccEl : (ccEl?.querySelector(".kh-command-center") ?? null);
  const panes = root ? [...root.querySelectorAll(":scope > .kh-command-center-scroll > .kh-command-center-layout > .kh-command-center-pane")] : [];
  const [left, center, right] = panes;
  const tiles = root ? root.querySelectorAll(".kh-command-center-tile").length : 0;
  const vitals = right?.querySelector(".kh-command-center-vitals-card") ?? null;
  const vitalsText = vitals?.textContent ?? "";
  const brainHost = root?.querySelector(":scope > .kh-brain-host-backdrop") ?? null; // full-view backdrop behind the cards
  const spendFirst = center?.firstElementChild?.classList.contains("kh-command-center-spend") === true;
  const retroCard = [...(left?.querySelectorAll(".kh-command-center-card") ?? [])].find((c) => c.querySelector("h4")?.textContent === "Retro");

  const checks = {
    opened: ccLeaves.length >= 1 && root !== null,
    tiles: tiles === ${EXPECTED_TILES},
    columns: panes.length === 3 && center?.classList.contains("kh-command-center-pane-main") === true,
    vitals: vitals !== null && (vitalsText.includes("module disabled") || ${JSON.stringify(VITALS_LABELS)}.every((l) => vitalsText.includes(l))),
    brain3d: brainHost !== null && (brainHost.querySelector("canvas") !== null || (brainHost.textContent ?? "").includes("Brain module is disabled")),
    spendTop: spendFirst,
    retro: retroCard !== undefined && left.contains(retroCard),
  };
  const details = { tiles, panes: panes.length, vitalsRows: ${JSON.stringify(VITALS_LABELS)}.filter((l) => vitalsText.includes(l)).length };

  const brainLeaf = app.workspace.getLeaf(true);
  await brainLeaf.setViewState({ type: "${BRAIN_VIEW_TYPE}", active: true });
  await sleep(1500);
  const brainRoot = brainLeaf.view.contentEl;
  const gaps = brainRoot.querySelector(".kh-brain-gaps");
  const gapsText = gaps?.textContent ?? "";
  const gapRows = brainRoot.querySelectorAll(".kh-brain-gaps-row").length;
  const brainHostFull = brainRoot.querySelector(".kh-brain-host-full");
  checks.brainTab = brainHostFull !== null
    && (brainHostFull.querySelector("canvas") !== null || brainRoot.querySelector(".kh-brain-empty") !== null)
    && gaps !== null
    && (gapRows > 0 || gapsText.includes("${GAPS_NO_DATA}"));
  details.gapRows = gapRows;

  for (const l of app.workspace.getLeavesOfType("${BRAIN_VIEW_TYPE}")) l.detach();
  for (const l of ccLeaves) l.detach();
  const failed = Object.keys(checks).filter((k) => checks[k] !== true);
  return { ok: failed.length === 0, failed, checks, details };
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
    console.error(`FAIL: ${result.failed.join(", ")}`);
    process.exitCode = 1;
  } else console.log("PASS");
}

main().catch((e) => {
  console.error(String(e.message ?? e));
  process.exitCode = 1;
});
