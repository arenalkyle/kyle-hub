import { describe, expect, it } from "vitest";
import { DEFAULT_STATUSES } from "../../../../core/domain/defaults";
import { BASE_FILES } from "../../../../core/domain/bases";
import { bootstrapFolder, ensureBaseSlices } from "./bootstrap";

function mem(files: Record<string, string> = {}) {
  const dirs = new Set<string>();
  const adapter = {
    exists: async (p: string) => p in files || dirs.has(p),
    mkdir: async (p: string) => void dirs.add(p),
    read: async (p: string) => files[p]!,
    write: async (p: string, d: string) => void (files[p] = d),
  };
  return { adapter: adapter as never, files, dirs };
}

describe("ensureBaseSlices", () => {
  it("creates the four files on setup", async () => {
    const m = mem();
    await bootstrapFolder(m.adapter, "Tickets", "TIX", DEFAULT_STATUSES);
    for (const f of BASE_FILES) expect(m.files[`Tickets/${f}`]).toContain("views:");
  });
  it("never overwrites an existing (user-edited) file", async () => {
    const m = mem({ "Tickets/Queue.base": "my edits" });
    m.dirs.add("Tickets");
    const created = await ensureBaseSlices(m.adapter, { folder: "Tickets", statuses: DEFAULT_STATUSES });
    expect(m.files["Tickets/Queue.base"]).toBe("my edits");
    expect(created).toEqual(["Triage.base", "Proposals.base", "Blocked.base"]);
    expect(await ensureBaseSlices(m.adapter, { folder: "Tickets", statuses: DEFAULT_STATUSES })).toEqual([]);
  });
  it("does nothing when the tickets folder does not exist", async () => {
    const m = mem();
    expect(await ensureBaseSlices(m.adapter, { folder: "Tickets", statuses: DEFAULT_STATUSES })).toEqual([]);
  });
});
