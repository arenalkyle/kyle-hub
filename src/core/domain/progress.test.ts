import { describe, expect, it } from "vitest";
import { parentProgress } from "./progress";
import type { Issue, StatusDef } from "./types";

const statuses: StatusDef[] = [
  { name: "Todo", category: "unstarted", color: "", order: 1 },
  { name: "Doing", category: "started", color: "", order: 2 },
  { name: "Done", category: "completed", color: "", order: 3 },
  { name: "Canceled", category: "canceled", color: "", order: 4 },
];
const t = (id: string, status: string, parent?: string): Issue => ({ id, title: `T ${id}`, status, parent }) as Issue;

describe("parentProgress", () => {
  it("counts done children, ignores canceled, names the current child", () => {
    const r = parentProgress(
      [t("P", "Doing"), t("A", "Done", "P"), t("B", "Doing", "P"), t("C", "Todo", "P"), t("D", "Canceled", "P"), t("E", "Todo")],
      statuses,
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ done: 1, total: 3, percent: 33 });
    expect(r[0]!.current?.id).toBe("B");
  });

  it("skips completed parents and parents without children", () => {
    expect(parentProgress([t("P", "Done"), t("A", "Done", "P")], statuses)).toEqual([]);
  });
});
