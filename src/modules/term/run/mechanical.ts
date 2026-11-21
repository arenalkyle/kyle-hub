export interface MechanicalSummaryInput {
  runId: string;
  durationMs: number;
  costUsd: number;
  /** `git diff --stat` output (may be empty). */
  diffStat: string;
  commits: string[];
  criteria: { checked: number; total: number };
  exitCode?: number;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** The comment the plugin posts as `@kyle-hub` when the agent did not leave a summary. Deterministic: no AI. */
export function mechanicalSummary(i: MechanicalSummaryInput): string {
  const lines = [
    `Run ${i.runId} ended without an agent summary. This is a mechanical summary written by kyle-hub.`,
    "",
    `- Duration: ${formatDuration(i.durationMs)}`,
    `- Cost: $${i.costUsd.toFixed(2)}`,
    `- Acceptance criteria ticked: ${i.criteria.checked}/${i.criteria.total}`,
  ];
  if (i.exitCode !== undefined && i.exitCode !== 0) lines.push(`- Exit code: ${i.exitCode}`);
  const stat = i.diffStat.trimEnd();
  lines.push("", "Changes:", stat ? "```\n" + stat + "\n```" : "No file changes.");
  lines.push("", "Commits:");
  if (i.commits.length === 0) lines.push("No commits.");
  else for (const c of i.commits) lines.push(`- ${c}`);
  return lines.join("\n");
}
