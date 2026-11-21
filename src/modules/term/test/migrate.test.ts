import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SettingsRegistry, type ModuleData } from "../../../core";
import { isUntouched, migrateLegacyTerm, type LegacyAdapter } from "../src/migrate";
import { DEFAULT_SETTINGS, normalizeTerm, termSettings, type TermData } from "../src/schema";

const FIX = path.join(__dirname, "fixtures");
const read = (p: string) => fs.readFileSync(path.join(FIX, p), "utf8");
const OLD = "d:/vault/.obsidian/plugins/kyle-term/data.json";

function memAdapter(files: Record<string, string>) {
  const writes: string[] = [];
  const a: LegacyAdapter = {
    exists: async (p) => p in files,
    read: async (p) => files[p]!,
    write: async (p, d) => {
      files[p] = d;
      writes.push(p);
    },
  };
  return { a, files, writes };
}

function freshNamespace(): ModuleData {
  const s = new SettingsRegistry();
  s.register(termSettings);
  return s.load({}).modules.term;
}

describe("settings migration from kyle-term", () => {
  it("golden: fixture data.json becomes modules.term, second run is a no-op, .bak written once", async () => {
    const text = read("kyle-term-data.json");
    const { a, files, writes } = memAdapter({ [OLD]: text });
    const ns = freshNamespace();
    expect(isUntouched(ns)).toBe(true);
    expect(await migrateLegacyTerm(a, "d:/vault/.obsidian", ns)).toBe(true);
    expect(JSON.parse(JSON.stringify(ns))).toEqual(JSON.parse(read("kyle-term-data.expected.json")));
    expect(files[`${OLD}.bak`]).toBe(text);
    const snapshot = JSON.stringify(ns);
    expect(await migrateLegacyTerm(a, "d:/vault/.obsidian", ns)).toBe(false);
    expect(JSON.stringify(ns)).toBe(snapshot);
    expect(writes).toEqual([`${OLD}.bak`]);
    expect(files[OLD]).toBe(text);
  });

  it("keeps the hub enabled flag and survives a registry reload", async () => {
    const { a } = memAdapter({ [OLD]: read("kyle-term-data.json") });
    const s = new SettingsRegistry();
    s.register(termSettings);
    const raw = s.load({ modules: { term: { enabled: false } } });
    expect(await migrateLegacyTerm(a, "d:/vault/.obsidian", raw.modules.term)).toBe(true);
    const again = new SettingsRegistry();
    again.register(termSettings);
    const d = again.load(JSON.parse(JSON.stringify(raw))).modules.term as unknown as TermData & { enabled: boolean };
    expect(d.enabled).toBe(false);
    expect(d.defaultProfile).toBe("gitbash");
    expect(d.sessions.map((x) => x.id)).toEqual(["a1b2-0", "c3d4-1"]);
    expect(d.sounds.events.finished.sound).toBe("bell");
    expect(d.sounds.events["needs-input"]).toEqual(DEFAULT_SETTINGS.sounds.events["needs-input"]);
  });

  it("does nothing without an old file, with junk, or when the namespace already has data", async () => {
    const ns = freshNamespace();
    expect(await migrateLegacyTerm(memAdapter({}).a, "c", ns)).toBe(false);
    const junk = memAdapter({ "c/plugins/kyle-term/data.json": "{nope" });
    expect(await migrateLegacyTerm(junk.a, "c", ns)).toBe(false);
    expect(junk.writes).toEqual([]);
    const used = freshNamespace();
    (used as unknown as TermData).nodePath = "x";
    const ok = memAdapter({ "c/plugins/kyle-term/data.json": read("kyle-term-data.json") });
    expect(await migrateLegacyTerm(ok.a, "c", used)).toBe(false);
    expect((used as unknown as TermData).nodePath).toBe("x");
    expect(ok.writes).toEqual([]);
  });

  it("normalizing a fresh namespace leaves it untouched, and never shares default arrays", () => {
    const ns = freshNamespace();
    normalizeTerm(ns);
    expect(isUntouched(ns)).toBe(true);
    expect((ns as unknown as TermData).savedFolders).not.toBe(DEFAULT_SETTINGS.savedFolders);
  });
});
