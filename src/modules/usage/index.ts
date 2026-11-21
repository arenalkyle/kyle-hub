import { Notice, Setting } from "obsidian";
import type { Hub, HubModule, ModuleContext } from "../../core";
import { accountsOf } from "../../core/accounts";
import { DEFAULT_CAPS, formatCountdown, usageLine, type AccountUsage, type ThresholdHit } from "../../core/domain/usage";
import { DEFAULT_USAGE_SETTINGS, usageSettingsOf, UsageTracker } from "../../core/usage/service";
import { cliOfficialReader } from "./official";

export const usageSettings = {
  id: "usage" as const,
  defaults: { caps: { ...DEFAULT_CAPS }, budgets: {}, officialReading: false, warnPercent: 80, fired: [] as string[] },
  enabledByDefault: true,
};

const REFRESH_MS = 60_000;
const INGEST_EVERY_MS = 120_000;

const WINDOW_TEXT = { session: "session window", week: "weekly usage", month: "monthly budget", day: "daily budget" } as const;

/** The chip text: the default account only, compact. */
export function chipText(u: AccountUsage | undefined, now: number): string {
  if (!u) return "";
  if (u.enterprise) return `${u.label} $${u.enterprise.todayUsd.toFixed(2)} today`;
  const s = u.subscription;
  return `${u.label} ${s?.sessionPercent ?? 0}% · wk ${s?.weekPercent ?? 0}%${u.session.active ? ` · ${formatCountdown(u.session.resetsAt, now)}` : ""}${u.source === "official" ? "" : " est."}`;
}

export const usageModule: HubModule = {
  id: "usage",
  load(hub: Hub, ctx: ModuleContext) {
    const raw = (): Record<string, unknown> => ctx.settings.get() as unknown as Record<string, unknown>;
    const fired = new Set<string>(Array.isArray(raw().fired) ? (raw().fired as string[]) : []);
    const claude = (): string => ((hub.settings.module("term") as { claudeCommand?: string }).claudeCommand || "claude");
    const t = new UsageTracker({
      logs: () => hub.services.get("logs"),
      accounts: () => accountsOf(hub.settings.module("core")).list,
      settings: () => usageSettingsOf(raw()),
      official: (a) => cliOfficialReader(claude())(a),
      fired,
      persistFired: (keys) => void ctx.settings.update({ fired: keys }),
      onThreshold: (hit) => hub.events.emit("usage:threshold", hit),
    });
    hub.services.register("usage", { snapshot: () => t.snapshot(), lines: () => t.lines(), subscribe: (cb) => t.subscribe(cb) });
    ctx.register(() => hub.services.unregister("usage"));

    const chip = ctx.addStatusBarItem();
    chip.addClass("kh-usage-chip");
    const paintChip = async (): Promise<void> => {
      const snap = await t.snapshot().catch(() => [] as AccountUsage[]);
      const def = accountsOf(hub.settings.module("core")).default;
      const u = snap.find((x) => x.accountId === def) ?? snap[0];
      chip.setText(chipText(u, Date.now()));
      chip.setAttr("title", snap.map((x) => usageLine(x, Date.now())).join("\n") || "No accounts");
      chip.toggleClass("kh-usage-chip-hidden", !u);
    };
    let lastIngest = 0;
    let busy = false;
    const refresh = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      try {
        if (Date.now() - lastIngest > INGEST_EVERY_MS) {
          lastIngest = Date.now();
          await hub.services.get("logs")?.ingest().catch(() => undefined);
          t.invalidate();
        }
        await t.check();
        await paintChip();
      } finally {
        busy = false;
      }
    };
    ctx.register(hub.events.on("run:ingested", () => { t.invalidate(); void refresh(); }));
    ctx.register(hub.events.on("usage:threshold", (hit) => void warn(hub, hit)));
    ctx.registerInterval(window.setInterval(() => void refresh(), REFRESH_MS));
    void refresh();
    ctx.addCommand({ id: "usage-refresh", name: "Refresh usage", callback: () => { t.invalidate(); void refresh(); } });
    ctx.addSettingsSection({ render: (el) => renderSettings(el, hub, ctx) });
  },
};

/** Warns with a notice and a comment on each running ticket of that account. Never switches accounts. */
async function warn(hub: Hub, hit: ThresholdHit): Promise<void> {
  const acc = accountsOf(hub.settings.module("core")).list.find((a) => a.id === hit.accountId);
  const text = `Usage warning: ${acc?.label ?? hit.accountId} is at ${hit.percent}% of its ${WINDOW_TEXT[hit.window]} (estimate). kyle-hub does not switch accounts.`;
  new Notice(`kyle-hub: ${text}`);
  const tickets = hub.services.get("tickets");
  if (!tickets) return;
  for (const r of hub.services.get("attention")?.running() ?? []) {
    if (r.accountId !== hit.accountId) continue;
    try {
      await tickets.comment(r.ticketId, text, { author: "kyle-hub" });
    } catch (e) {
      console.error("kyle-hub: usage comment failed", e);
    }
  }
}

function renderSettings(el: HTMLElement, hub: Hub, ctx: ModuleContext): void {
  const s = usageSettingsOf(ctx.settings.get());
  el.createEl("h3", { text: "Usage" });
  el.createEl("p", { cls: "setting-item-description", text: "Session (5 h) and week (7 d) usage per account, estimated from local transcripts (other machines and apps are not seen). Caps are tokens; calibrate them against /usage." });
  new Setting(el)
    .setName("Warn at (%)")
    .setDesc("Notice and a comment on running tickets, once per window. Never switches accounts.")
    .addText((x) => x.setValue(String(s.warnPercent)).onChange((v) => { const n = Number(v); if (n > 0) void ctx.settings.update({ warnPercent: n }); }));
  new Setting(el)
    .setName("Official reading (best-effort)")
    .setDesc("Asks each subscription account's own claude CLI for /usage. Undocumented and may break; falls back to the estimate. Off by default.")
    .addToggle((x) => x.setValue(s.officialReading).onChange((v) => void ctx.settings.update({ officialReading: v })));
  const plans = new Set([...Object.keys(s.caps), ...accountsOf(hub.settings.module("core")).list.filter((a) => a.kind === "subscription" && a.plan).map((a) => a.plan.toLowerCase())]);
  for (const plan of [...plans].sort()) {
    const cap = s.caps[plan] ?? DEFAULT_USAGE_SETTINGS.caps.default!;
    const save = (k: "session" | "week", v: string): void => {
      const n = Number(v);
      if (!(n > 0)) return;
      const cur = usageSettingsOf(ctx.settings.get());
      void ctx.settings.update({ caps: { ...cur.caps, [plan]: { ...(cur.caps[plan] ?? cap), [k]: n } } });
    };
    new Setting(el)
      .setName(`Cap: ${plan}`)
      .setDesc("Tokens per session block / per week.")
      .addText((x) => x.setValue(String(cap.session)).onChange((v) => save("session", v)))
      .addText((x) => x.setValue(String(cap.week)).onChange((v) => save("week", v)));
  }
  for (const a of accountsOf(hub.settings.module("core")).list.filter((x) => x.kind === "enterprise")) {
    const b = s.budgets[a.id] ?? {};
    const save = (k: "dayUsd" | "monthUsd", v: string): void => {
      const cur = usageSettingsOf(ctx.settings.get());
      const n = Number(v);
      const entry = { ...(cur.budgets[a.id] ?? {}) };
      if (n > 0) entry[k] = n;
      else delete entry[k];
      void ctx.settings.update({ budgets: { ...cur.budgets, [a.id]: entry } });
    };
    new Setting(el)
      .setName(`Budget: ${a.label}`)
      .setDesc("USD per day / per month (blank = none).")
      .addText((x) => x.setValue(b.dayUsd ? String(b.dayUsd) : "").onChange((v) => save("dayUsd", v)))
      .addText((x) => x.setValue(b.monthUsd ? String(b.monthUsd) : "").onChange((v) => save("monthUsd", v)));
  }
}
