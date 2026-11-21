import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SettingsRegistry, type ModuleData } from "../../../core";
import { parseIssue, serializeIssue } from "../../../core/domain/issueFile";
import { parseProject, serializeProject } from "../../../core/domain/projectFile";
import { defaultData } from "../src/data";
import { dataFromNamespace, isUntouched, migrateLegacyTickets, type LegacyAdapter } from "../src/migrate";
import { queryIssues } from "../src/service";
import { IssueStore } from "../src/store/IssueStore";
import { ticketsSettings } from "../src/schema";

const FIX = path.join(__dirname, "fixtures");
const read = (p: string) => fs.readFileSync(path.join(FIX, p), "utf8");
const OLD = "d:/vault/.obsidian/plugins/kyle-tickets/data.json";

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
  s.register(ticketsSettings);
  return s.load({}).modules.tickets;
}

describe("settings migration from kyle-tickets", () => {
  it("golden: fixture data.json becomes modules.tickets, second run is a no-op, .bak written once", async () => {
    const text = read("kyle-tickets-data.json");
    const { a, files, writes } = memAdapter({ [OLD]: text });
    const ns = freshNamespace();
    expect(isUntouched(ns)).toBe(true);
    expect(await migrateLegacyTickets(a, "d:/vault/.obsidian", ns)).toBe(true);
    const old = JSON.parse(text);
    expect(ns).toEqual({ enabled: true, ...old, settings: { ...defaultData().settings, ...old.settings } });
    expect(files[`${OLD}.bak`]).toBe(text);
    const snapshot = JSON.stringify(ns);
    expect(await migrateLegacyTickets(a, "d:/vault/.obsidian", ns)).toBe(false);
    expect(JSON.stringify(ns)).toBe(snapshot);
    expect(writes).toEqual([`${OLD}.bak`]);
    expect(files[OLD]).toBe(text);
  });

  it("survives a registry reload and keeps the hub enabled flag", async () => {
    const { a } = memAdapter({ [OLD]: read("kyle-tickets-data.json") });
    const s = new SettingsRegistry();
    s.register(ticketsSettings);
    const raw = s.load({ modules: { tickets: { enabled: false } } });
    expect(await migrateLegacyTickets(a, "d:/vault/.obsidian", raw.modules.tickets)).toBe(true);
    const again = new SettingsRegistry();
    again.register(ticketsSettings);
    const d = again.load(JSON.parse(JSON.stringify(raw))).modules.tickets;
    expect(d.enabled).toBe(false);
    expect(dataFromNamespace(d).settings.prefix).toBe("WRK");
    expect(dataFromNamespace(d).idCounter).toBe(41);
  });

  it("does nothing without an old file, with junk, or when the namespace already has data", async () => {
    const ns = freshNamespace();
    expect(await migrateLegacyTickets(memAdapter({}).a, "c", ns)).toBe(false);
    const junk = memAdapter({ "c/plugins/kyle-tickets/data.json": "{nope" });
    expect(await migrateLegacyTickets(junk.a, "c", ns)).toBe(false);
    expect(junk.writes).toEqual([]);
    const used = freshNamespace();
    used.idCounter = 5;
    const ok = memAdapter({ "c/plugins/kyle-tickets/data.json": read("kyle-tickets-data.json") });
    expect(await migrateLegacyTickets(ok.a, "c", used)).toBe(false);
    expect(used.idCounter).toBe(5);
    expect(ok.writes).toEqual([]);
  });
});

describe("round trip", () => {
  it("ticket and project fixtures serialize byte-identical", () => {
    for (const f of fs.readdirSync(path.join(FIX, "Issues"))) {
      const text = read(`Issues/${f}`);
      expect(serializeIssue(parseIssue(text, f))).toBe(text);
    }
    const proj = read("Projects/Web.md");
    expect(serializeProject(parseProject(proj, "Web.md"))).toBe(proj);
  });

  it("IssueStore loads the fixtures and a no-op update leaves every file untouched", async () => {
    const files = new Map<string, string>();
    for (const f of fs.readdirSync(path.join(FIX, "Issues"))) files.set(`Tickets/Issues/${f}`, read(`Issues/${f}`));
    files.set("Tickets/Projects/Web.md", read("Projects/Web.md"));
    const before = new Map(files);
    const file = (p: string) => (files.has(p) ? { path: p, name: p.split("/").pop()!, stat: {} } : null);
    const vault = {
      on: () => ({}),
      getMarkdownFiles: () => [...files.keys()].map((p) => file(p)),
      getAbstractFileByPath: (p: string) => file(p),
      read: async (f: { path: string }) => files.get(f.path)!,
      process: async (f: { path: string }, fn: (t: string) => string) => {
        const out = fn(files.get(f.path)!);
        files.set(f.path, out);
        return out;
      },
    };
    const store = new IssueStore({
      app: { vault, metadataCache: { on: () => ({}) } } as never,
      data: defaultData(),
      savePluginData: async () => {},
      registerEvent: () => {},
    });
    await store.start();
    expect(store.getIssues().map((i) => i.id).sort()).toEqual(["TIX-12", "TIX-3"]);
    expect(store.getProjects().map((p) => p.name)).toEqual(["Web"]);
    await store.updateIssue("TIX-12", {});
    expect(files).toEqual(before);
  });
});

describe("TicketService query", () => {
  const issues = [
    { id: "TIX-1", title: "Alpha", status: "Todo", tags: ["bug"], project: "[[Web]]", assignee: "kyle" },
    { id: "TIX-2", title: "Beta", status: "Done", tags: [], parent: "[[TIX-1]]" },
  ] as never[];
  it("filters by status, project, tag, parent and text", () => {
    const ids = (q: object) => queryIssues(issues, q).map((i) => i.id);
    expect(ids({})).toEqual(["TIX-1", "TIX-2"]);
    expect(ids({ status: ["Done"] })).toEqual(["TIX-2"]);
    expect(ids({ project: "Web" })).toEqual(["TIX-1"]);
    expect(ids({ tag: "bug" })).toEqual(["TIX-1"]);
    expect(ids({ parent: "TIX-1" })).toEqual(["TIX-2"]);
    expect(ids({ text: "bet" })).toEqual(["TIX-2"]);
  });
});

describe("css prefix", () => {
  it("leaves no kt- class in tickets sources or styles.css", () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name) && /\bkt-/.test(fs.readFileSync(p, "utf8"))) hits.push(p);
      }
    };
    walk(path.join(__dirname, "..", "src"));
    if (/\bkt-/.test(fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", "styles.css"), "utf8"))) hits.push("styles.css");
    expect(hits).toEqual([]);
  });
});
