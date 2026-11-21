import type { NewIssueInput } from "../../../core/domain/create";
import { fromLink } from "../../../core/domain/links";
import type { IssuePatch } from "../../../core/domain/issueFile";
import type { Issue } from "../../../core/domain/types";
import { planAgentCreate } from "../../../core/domain/agentCreate";
import { DEFAULT_FLOOD } from "../../../core/domain/flood";
import { checkAgentLabels, checkAgentStatus, GATE_EXIT } from "../../../core/domain/gates";
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

class AgentRefusal extends Error {
  constructor(
    message: string,
    readonly exitCode: number = GATE_EXIT,
  ) {
    super(message);
  }
}

const refuseIfAgent = (r: { ok: true } | { ok: false; exitCode: number; message: string }): void => {
  if (!r.ok) throw new AgentRefusal(r.message, r.exitCode);
};

/** `TicketService` over `IssueStore`, which stays the only writer. `actor.agent` applies the same gates as `kh`. */
export function createTicketService(store: IssueStore): TicketService {
  const sourceOf = (actor: TicketActor): `agent:${string}` => `agent:${actor.author ?? "session"}`;
  return {
    get: (id) => store.getIssue(id),
    list: (query) => queryIssues(store.getIssues(), query),
    create: async (input: NewIssueInput, actor: TicketActor = {}) => {
      if (!actor.agent) return store.createIssue(input, actor.author);
      const source = sourceOf(actor);
      const plan = planAgentCreate(
        { title: input.title, type: input.type, repo: input.repo, tags: input.tags },
        { statuses: store.getStatuses(), issues: store.getIssues(), source, flood: DEFAULT_FLOOD },
      );
      if (!plan.ok) throw new AgentRefusal(plan.message, plan.exitCode);
      if (plan.duplicate) return store.addComment(plan.duplicate.id, `seen again (+1) from ${source}`, source);
      return store.createIssue({ ...input, status: plan.status, source, fingerprint: plan.fingerprint }, source);
    },
    update: async (id: string, patch: IssuePatch, actor: TicketActor = {}) => {
      if (actor.agent) {
        const current = store.getIssue(id);
        if (patch.status !== undefined && patch.status !== null) refuseIfAgent(checkAgentStatus(patch.status, store.getStatuses()));
        const added = (patch.tags ?? []).filter((t) => !(current?.tags ?? []).includes(t));
        refuseIfAgent(checkAgentLabels(added));
      }
      return store.updateIssue(id, patch, actor.author);
    },
    comment: (id, body, actor = {}) => store.addComment(id, body, actor.author),
    childrenOf: (id) => store.childrenOf(id),
    subscribe: (cb) => store.on("change", cb),
  };
}
