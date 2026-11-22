import { describe, expect, it } from "vitest";
import type { Issue, StatusDef } from "../../../core/domain/types";
import { queueCounts } from "../src/queueCounts";

const statuses: StatusDef[] = [
  { name: "Triage", category: "triage", color: "#000", order: 0 },
  { name: "Backlog", category: "backlog", color: "#000", order: 1 },
  { name: "Todo", category: "unstarted", color: "#000", order: 2 },
  { name: "Doing", category: "started", color: "#000", order: 3 },
];
const issue = (status: string): Issue => ({ id: status, status } as unknown as Issue);

describe("queueCounts", () => {
  it("counts triage separately from todo (unstarted + backlog)", () => {
    const issues = [issue("Triage"), issue("Triage"), issue("Backlog"), issue("Todo"), issue("Doing")];
    expect(queueCounts(issues, statuses)).toEqual({ triage: 2, todo: 2 });
  });

  it("is zero for an empty board", () => {
    expect(queueCounts([], statuses)).toEqual({ triage: 0, todo: 0 });
  });
});
