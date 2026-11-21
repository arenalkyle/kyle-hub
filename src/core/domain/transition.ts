import { parseAcceptance } from "./acceptance";
import { categoryOf } from "./fields";
import type { Issue, StatusDef } from "./types";

export type StatusGuard = { ok: true } | { ok: false; needsConfirm: true; unchecked: number; total: number };

/**
 * Shared guard for every UI status change (ADR-0005): entering a completed-category status from a
 * non-completed one with unchecked acceptance criteria needs a human confirmation.
 */
export function guardStatusChange(issue: Pick<Issue, "status" | "description">, next: string, statuses: readonly StatusDef[]): StatusGuard {
  if (next === issue.status) return { ok: true };
  if (categoryOf(next, statuses) !== "completed" || categoryOf(issue.status, statuses) === "completed") return { ok: true };
  const { total, checked } = parseAcceptance(issue.description);
  const unchecked = total - checked;
  return unchecked > 0 ? { ok: false, needsConfirm: true, unchecked, total } : { ok: true };
}

export const doneConfirmMessage = (g: { unchecked: number; total: number }): string =>
  `${g.unchecked} of ${g.total} criteria unchecked. Mark done anyway?`;

export const overrideEventText = (unchecked: number): string => `marked done with ${unchecked} unchecked ${unchecked === 1 ? "criterion" : "criteria"} (override)`;
