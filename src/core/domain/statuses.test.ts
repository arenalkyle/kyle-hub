import { describe, expect, it } from "vitest";
import { DEFAULT_STATUSES, DEFAULT_STATUS_NAME } from "./defaults";
import {
  normalizeOrder, renameStatusIn, uniqueStatusName, validateDelete, validateStatuses,
} from "./statuses";
import type { StatusDef } from "./types";

const list = (): StatusDef[] => DEFAULT_STATUSES.map((s) => ({ ...s }));

describe("validateStatuses", () => {
  it("accepts the defaults", () => {
    expect(validateStatuses(list(), DEFAULT_STATUS_NAME)).toBeNull();
  });
  it("requires exactly one default that exists", () => {
    expect(validateStatuses(list(), "Nope")).toMatch(/default/);
    expect(validateStatuses(list(), "")).toMatch(/default/);
  });
  it("rejects empty and duplicate names (case-insensitive)", () => {
    const l = list();
    l[2]!.name = "  ";
    expect(validateStatuses(l, DEFAULT_STATUS_NAME)).toMatch(/empty/);
    const d = list();
    d[2]!.name = "backlog";
    expect(validateStatuses(d, DEFAULT_STATUS_NAME)).toMatch(/Duplicate/);
  });
  it("keeps a status in every used category", () => {
    const l = list().map((s) => (s.name === "Done" ? { ...s, category: "started" as const } : s));
    expect(validateStatuses(l, DEFAULT_STATUS_NAME, ["completed"])).toMatch(/Completed/);
    expect(validateStatuses(l, DEFAULT_STATUS_NAME, ["started"])).toBeNull();
  });
});

describe("validateDelete", () => {
  it("requires reassignment when issues use the status", () => {
    expect(validateDelete(list(), DEFAULT_STATUS_NAME, "Todo", undefined, 3)).toMatch(/Choose a status/);
    expect(validateDelete(list(), DEFAULT_STATUS_NAME, "Todo", "Todo", 3)).toMatch(/different/);
    expect(validateDelete(list(), DEFAULT_STATUS_NAME, "Todo", "Ghost", 3)).toMatch(/different/);
    expect(validateDelete(list(), DEFAULT_STATUS_NAME, "Todo", "Backlog", 3)).toBeNull();
  });
  it("allows deleting an unused status without reassignment", () => {
    expect(validateDelete(list(), DEFAULT_STATUS_NAME, "Duplicate", undefined, 0)).toBeNull();
  });
  it("never deletes the default", () => {
    expect(validateDelete(list(), DEFAULT_STATUS_NAME, "Backlog", "Todo", 0)).toMatch(/default/);
  });
  it("keeps used categories populated", () => {
    expect(validateDelete(list(), DEFAULT_STATUS_NAME, "Done", "Todo", 2, ["completed"])).toMatch(/Completed/);
    expect(validateDelete(list(), DEFAULT_STATUS_NAME, "In Review", "In Progress", 2, ["started"])).toBeNull();
  });
});

describe("helpers", () => {
  it("renumbers order", () => {
    expect(normalizeOrder(list().reverse()).map((s) => s.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it("makes unique names", () => {
    const l = list();
    expect(uniqueStatusName(l)).toBe("New status");
    l.push({ name: "New status", category: "started", color: "#000", order: 8 });
    expect(uniqueStatusName(l)).toBe("New status 2");
  });
  it("rename rejects duplicates and empties", () => {
    expect("error" in renameStatusIn(list(), "Todo", "done")).toBe(true);
    expect("error" in renameStatusIn(list(), "Todo", " ")).toBe(true);
    const ok = renameStatusIn(list(), "In Review", "Review");
    expect("statuses" in ok && ok.statuses.some((s) => s.name === "Review")).toBe(true);
  });
});
