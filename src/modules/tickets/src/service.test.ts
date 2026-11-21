import { describe, expect, it, vi } from "vitest";
import { DEFAULT_STATUSES } from "../../../core/domain/defaults";
import type { Issue } from "../../../core/domain/types";
import { createTicketService } from "./service";
import type { IssueStore } from "./store/IssueStore";

const issue = (id: string, status: string, tags: string[] = []): Issue => ({ id, title: id, status, tags }) as unknown as Issue;

function fake(issues: Issue[]) {
  return {
    getIssue: (id: string) => issues.find((i) => i.id === id),
    getIssues: () => issues,
    getStatuses: () => DEFAULT_STATUSES,
    updateIssue: vi.fn(async (id: string) => issues.find((i) => i.id === id)!),
    createIssue: vi.fn(async () => issue("NEW-1", "Triage")),
    addComment: vi.fn(async (id: string) => issues.find((i) => i.id === id)!),
    logEvent: vi.fn(async (id: string) => issues.find((i) => i.id === id)!),
    removeComment: vi.fn(async (id: string) => issues.find((i) => i.id === id)!),
    childrenOf: () => [],
    on: () => () => undefined,
  };
}

describe("plugin-side TicketService gates", () => {
  it("refuses agent writes to Done and agent-ready, allows human ones", async () => {
    const store = fake([issue("T-1", "Todo")]);
    const svc = createTicketService(store as unknown as IssueStore);
    await expect(svc.update("T-1", { status: "Done" }, { agent: true })).rejects.toThrow(/human-only/);
    await expect(svc.update("T-1", { tags: ["agent-ready"] }, { agent: true })).rejects.toThrow(/agent-ready/);
    expect(store.updateIssue).not.toHaveBeenCalled();
    await svc.update("T-1", { status: "Done", tags: ["agent-ready"] });
    expect(store.updateIssue).toHaveBeenCalledOnce();
  });
  it("uses the configured flood caps, not the defaults", async () => {
    const triage = [issue("T-1", "Triage"), issue("T-2", "Triage")];
    const input = { title: "Fresh finding", tags: [] };
    const tight = createTicketService(fake(triage) as unknown as IssueStore, () => ({ maxNewPerRun: 5, maxOpenTriage: 2, expireDays: 14 }));
    await expect(tight.create(input, { agent: true })).rejects.toThrow();
    const loose = fake(triage);
    await createTicketService(loose as unknown as IssueStore, () => ({ maxNewPerRun: 5, maxOpenTriage: 50, expireDays: 14 })).create(input, { agent: true });
    expect(loose.createIssue).toHaveBeenCalledOnce();
  });
  it("exposes logEvent and removeComment", async () => {
    const store = fake([issue("T-1", "Triage")]);
    const svc = createTicketService(store as unknown as IssueStore);
    await svc.logEvent("T-1", "accepted", { author: "me" });
    await svc.removeComment("T-1", "L0");
    expect(store.logEvent).toHaveBeenCalledWith("T-1", "accepted", "me");
    expect(store.removeComment).toHaveBeenCalledWith("T-1", "L0");
  });
});
