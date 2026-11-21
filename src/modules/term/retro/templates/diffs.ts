import { createTwoFilesPatch } from "diff";
import type { Cluster } from "../types";
import type { TemplateContext } from "./types";

export const MAX_RUN_LINKS = 10;

/** Unified diff for one file under the target root; `before === undefined` creates it. */
export function fileDiff(rel: string, before: string | undefined, after: string): string {
  const name = rel.replace(/\\/g, "/");
  const patch = createTwoFilesPatch(before === undefined ? "/dev/null" : `a/${name}`, `b/${name}`, before ?? "", after, undefined, undefined, { context: 3 });
  return patch.replace(/^=+\r?\n/, "");
}

/** Lines the diff adds (without the `+++` header). */
export const addedLines = (diff: string): string[] => diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1));

export function appendLine(before: string | undefined, line: string): string {
  const base = before === undefined || before === "" || before.endsWith("\n") ? (before ?? "") : `${before}\n`;
  return `${base}${line}\n`;
}

/** Where a repo-scoped change goes: the repo when the cluster is single-repo and mapped, else the global Claude dir. */
export function targetRoot(cluster: Cluster, ctx: TemplateContext): { root: string; repo?: string } {
  const repoDir = ctx.repoPath(cluster.repo);
  return repoDir !== undefined ? { root: repoDir, repo: cluster.repo } : { root: ctx.claudeHome };
}

const day = (iso: string): string => iso.slice(0, 10);

/** Counts, sessions, first/last seen and `kh logs show` links (up to 10 run ids). */
export function evidence(cluster: Cluster): string {
  const lines = [
    "## Evidence",
    "",
    `Signature: \`${cluster.signature}\``,
    `Seen ${cluster.count}x across ${cluster.sessions.length} sessions (${day(cluster.firstSeen)} to ${day(cluster.lastSeen)}).`,
    ...(cluster.repo ? [`Repo: ${cluster.repo}`] : []),
    "",
    "Runs:",
    ...cluster.runIds.slice(0, MAX_RUN_LINKS).map((r) => `- \`kh logs show ${r}\``),
  ];
  return lines.join("\n");
}

export const truncate = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Parses `<kind>:<a>:<b...>` signatures. */
export const sigParts = (signature: string): string[] => signature.split(":");
