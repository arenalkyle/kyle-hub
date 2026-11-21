import type { TicketService } from "../../../core";
import { planTriage, undoPatch, type TriageAction, type UndoEntry } from "../../../core/domain/triage";
import type { StatusDef } from "../../../core/domain/types";

/** Applies a triage action through `TicketService` (gates apply). Returns the undo entry, or null when there is no target status. */
export async function runTriage(
  svc: TicketService,
  id: string,
  action: TriageAction,
  cfg: { statuses: readonly StatusDef[]; defaultStatus: string },
  reason = "",
): Promise<UndoEntry | null> {
  const issue = svc.get(id);
  if (!issue) return null;
  const plan = planTriage(issue, action, cfg.statuses, cfg.defaultStatus, reason);
  if (!plan) return null;
  const entry: UndoEntry = { id, before: { status: issue.status, tags: [...issue.tags] } };
  await svc.update(id, plan.patch);
  if (plan.event) await svc.logEvent(id, plan.event);
  if (plan.comment) {
    await svc.comment(id, plan.comment);
    entry.comment = plan.comment;
  }
  return entry;
}

/** Restores status and labels and removes the decline comment. */
export async function undoTriage(svc: TicketService, entry: UndoEntry): Promise<void> {
  if (entry.comment !== undefined) {
    const feed = svc.get(entry.id)?.feed ?? [];
    const c = [...feed].reverse().find((f) => f.type === "comment" && f.body === entry.comment);
    if (c && c.type === "comment") await svc.removeComment(entry.id, c.id);
  }
  await svc.update(entry.id, undoPatch(entry));
}
