import type { Cluster, RetroConfig, Signal } from "./types";

const MAX_RUN_IDS = 10;

const byTime = (a: Signal, b: Signal): number => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0);

/** Groups signals by signature; keeps clusters that meet both occurrence and distinct-session thresholds. */
export function cluster(signals: readonly Signal[], cfg: RetroConfig): Cluster[] {
  const groups = new Map<string, Signal[]>();
  for (const s of signals) groups.set(s.signature, [...(groups.get(s.signature) ?? []), s]);
  const out: Cluster[] = [];
  for (const [signature, group] of groups) {
    const sessions = [...new Set(group.map((s) => s.sessionId))];
    const ordered = [...group].sort(byTime);
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    if (!first || !last || group.length < cfg.minOccurrences || sessions.length < cfg.minSessions) continue;
    const repos = new Set(group.map((s) => s.repo));
    const repo = repos.size === 1 ? first.repo : undefined;
    out.push({
      signature,
      kind: first.kind,
      count: group.length,
      sessions,
      runIds: [...new Set(ordered.map((s) => s.runId))].slice(0, MAX_RUN_IDS),
      firstSeen: first.t,
      lastSeen: last.t,
      ...(repo !== undefined ? { repo } : {}),
    });
  }
  return out.sort((a, b) => b.count - a.count || (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0));
}
