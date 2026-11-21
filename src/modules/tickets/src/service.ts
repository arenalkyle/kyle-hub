import type { NewIssueInput } from "../../../core/domain/create";
import { fromLink } from "../../../core/domain/links";
import type { IssuePatch } from "../../../core/domain/issueFile";
import type { Issue } from "../../../core/domain/types";
import type { TicketActor, TicketQuery, TicketService } from "../../../core";
import type { IssueStore } from "./store/IssueStore";

/** Pure filter behind `TicketService.list`. */
export function queryIssues(issues: readonly Issue[], q: TicketQuery = {}): Issue[] {
  const text = q.text?.toLowerCase();
  const project = q.project === undefined ? undefined : fromLink(q.project);
  return issues.filter(
    (i) =>
      (q.status === undefined || q.status.includes(i.status)) &&
      (project === undefined || (i.project !== undefined && fromLink(i.project) === project)) &&
      (q.assignee === undefined || i.assignee === q.assignee) &&
      (q.tag === undefined || i.tags.includes(q.tag)) &&
      (q.parent === undefined || (i.parent !== undefined && fromLink(i.parent) === q.parent)) &&
      (text === undefined || i.id.toLowerCase().includes(text) || i.title.toLowerCase().includes(text)),
  );
}

/** `TicketService` over `IssueStore`, which stays the only writer. `actor.agent` gates arrive in 3.1. */
export function createTicketService(store: IssueStore): TicketService {
  return {
    get: (id) => store.getIssue(id),
    list: (query) => queryIssues(store.getIssues(), query),
    create: (input: NewIssueInput, actor: TicketActor = {}) => store.createIssue(input, actor.author),
    update: (id: string, patch: IssuePatch, actor: TicketActor = {}) => store.updateIssue(id, patch, actor.author),
    comment: (id, body, actor = {}) => store.addComment(id, body, actor.author),
    childrenOf: (id) => store.childrenOf(id),
    subscribe: (cb) => store.on("change", cb),
  };
}
