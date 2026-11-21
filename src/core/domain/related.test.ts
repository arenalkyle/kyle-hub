import { describe, expect, it } from "vitest";
import { addRelatedList, relatedIds, removeRelatedLists } from "./related";

const i = (id: string, related: string[] = []) => ({ id, related });

describe("related", () => {
  const all = [i("T-1", ["T-2", "T-9", "T-1"]), i("T-2"), i("T-3", ["T-1"]), i("T-4", ["T-1", "T-2"])];
  it("is symmetric, deduped, excludes self and missing", () => {
    expect(relatedIds(all[0]!, all)).toEqual(["T-2", "T-3", "T-4"]);
    expect(relatedIds(all[1]!, all)).toEqual(["T-1", "T-4"]);
  });
  it("add is a no-op when already related either way", () => {
    expect(addRelatedList(all[1]!, "T-1", all)).toBeNull();
    expect(addRelatedList(all[1]!, "T-2", all)).toBeNull();
    expect(addRelatedList(all[1]!, "T-3", all)).toEqual(["T-3"]);
  });
  it("remove touches only files holding the relation", () => {
    expect(removeRelatedLists(all[2]!, all[0]!)).toEqual([{ id: "T-3", related: [] }]);
    expect(removeRelatedLists(i("A", ["B"]), i("B", ["A"]))).toHaveLength(2);
    expect(removeRelatedLists(all[1]!, all[0]!)).toEqual([{ id: "T-1", related: ["T-9", "T-1"] }]);
  });
});
