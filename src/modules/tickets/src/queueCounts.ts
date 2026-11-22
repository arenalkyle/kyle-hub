import { categoryOf } from "../../../core/domain/fields";
import type { Issue, Settings } from "../../../core/domain/types";
import type { QueueCounts } from "../../../core/services";

/** Launch-queue sizes: Triage, and Todo (unstarted + backlog). Same split as the queue view. */
export function queueCounts(issues: readonly Issue[], statuses: Settings["statuses"]): QueueCounts {
  let triage = 0;
  let todo = 0;
  for (const issue of issues) {
    const cat = categoryOf(issue.status, statuses);
    if (cat === "triage") triage++;
    else if (cat === "unstarted" || cat === "backlog") todo++;
  }
  return { triage, todo };
}
